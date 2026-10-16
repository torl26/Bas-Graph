// 久留米市内の主要道路網を取得する。
//
// 元の設計(area(久留米市relation 4008314)による境界内クエリ、Overpass API)は
// この環境からは実行できなかった:
//   - overpass-api.de本家: 常に406 Not Acceptable(nginx層でのブロック。
//     サンドボックス内・ユーザー本人のマシンの両方で再現したため、
//     接続元に依存しない問題と判断)
//   - 代替ミラー overpass.kumi.systems: 接続自体は成功する場合があるが、
//     area(久留米市relation)クエリは毎回0件(このミラーのarea事前計算
//     キャッシュに対象リレーションが存在しない)。bboxクエリは機能したが
//     直後に429(レート制限)が持続し、30秒間隔×10回のリトライでも解消しなかった。
//
// そのため、OSM本家API(api.openstreetmap.org, /api/0.6/map)から取得する方式に
// 切り替えた。このAPIはタグでの絞り込みができず、bbox内の全要素(建物等を含む)を
// 返す上に1リクエストあたり50,000ノードの上限があるため、久留米市の
// bounding box(OSM API relation/4008314/fullの実ノード座標から算出)を
// 再帰的に4分割しながら取得し、最後にhighwayタグで道路のwayのみを抜き出す。
// 境界ポリゴンそのものではなくbboxでの取得のため、四隅に近隣自治体の道路が
// 多少混入する可能性があるが、可視化目的においては許容する
// (.superpowers/sdd/2026-10-15-hazard-map-road-graph/progress.md Task 3 Ruling参照)。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OSM_API_URL = 'https://api.openstreetmap.org/api/0.6/map';
// OSM APIの利用方針(https://operations.osmfoundation.org/policies/api/)は
// 識別可能なUser-Agentを要求する。Node標準のfetch()はUser-Agentを送らず、
// そのリクエストは(エラーメッセージ上は429だが実質的には)拒否されるため、
// 明示的に指定する。
const REQUEST_HEADERS = { 'User-Agent': 'bas-graph-hazard-map-road-fetch/1.0 (personal project, non-commercial)' };
// 久留米市行政境界(relation 4008314)の実ノードから計算したbounding box
const KURUME_BBOX = { west: 130.3852054, south: 33.2239595, east: 130.7318683, north: 33.3683778 };
// 車両が使う主要な道路網に絞る(歩道・自転車道・サービス道路は除外)。
// *_link(motorway_link等のインターチェンジ・ランプ)も含める: これが無いと
// motorway/trunkはランプを介してしか他の道路に接続しないOSMのデータ構造上、
// 高速道路網がグラフ上で完全に孤立してしまう(コードレビューで指摘・実データで
// 確認済み: 84件のmotorwayノードが1件も最大連結成分に含まれていなかった)。
const HIGHWAY_TYPES = new Set([
  'motorway', 'motorway_link',
  'trunk', 'trunk_link',
  'primary', 'primary_link',
  'secondary', 'secondary_link',
  'tertiary', 'tertiary_link',
  'unclassified', 'residential',
]);
const MAX_SPLIT_DEPTH = 8;
const REQUEST_DELAY_MS = 1500;
const MAX_RETRIES_PER_TILE = 3;
const MAX_509_WAITS = 6;
// OSM APIのダウンロード量クォータ(HTTP 509)に当たった場合に備えて、
// 取得済みタイルをディスクにキャッシュする。プロセスが途中で落ちても
// 再実行時に完了済みタイルを再取得せずに済む。
const CACHE_DIR = path.join(__dirname, '../.tile_cache');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function tileCacheKey(bbox) {
  return `${bbox.west.toFixed(7)}_${bbox.south.toFixed(7)}_${bbox.east.toFixed(7)}_${bbox.north.toFixed(7)}.json`;
}

function loadTileCache(bbox) {
  const file = path.join(CACHE_DIR, tileCacheKey(bbox));
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveTileCache(bbox, nodes, ways) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, tileCacheKey(bbox));
  fs.writeFileSync(file, JSON.stringify({ nodes, ways }));
}

function unescapeXml(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseOsmXml(xml) {
  const nodes = [];
  const nodeRegex = /<node\s+([^>]*?)\/?>/g;
  let m;
  while ((m = nodeRegex.exec(xml))) {
    const attrs = m[1];
    const idMatch = attrs.match(/\bid="(-?\d+)"/);
    const latMatch = attrs.match(/\blat="(-?[\d.]+)"/);
    const lonMatch = attrs.match(/\blon="(-?[\d.]+)"/);
    if (idMatch && latMatch && lonMatch) {
      nodes.push({ id: Number(idMatch[1]), lat: Number(latMatch[1]), lon: Number(lonMatch[1]) });
    }
  }

  const ways = [];
  const wayRegex = /<way\s+id="(-?\d+)"[^>]*>([\s\S]*?)<\/way>/g;
  while ((m = wayRegex.exec(xml))) {
    const id = Number(m[1]);
    const body = m[2];
    const wayNodes = [];
    const ndRegex = /<nd\s+ref="(-?\d+)"/g;
    let nm;
    while ((nm = ndRegex.exec(body))) wayNodes.push(Number(nm[1]));

    const tags = {};
    const tagRegex = /<tag\s+k="([^"]*)"\s+v="([^"]*)"/g;
    let tm;
    while ((tm = tagRegex.exec(body))) tags[unescapeXml(tm[1])] = unescapeXml(tm[2]);

    ways.push({ id, nodes: wayNodes, tags });
  }

  return { nodes, ways };
}

function splitBbox({ west, south, east, north }) {
  const midLon = (west + east) / 2;
  const midLat = (south + north) / 2;
  return [
    { west, south, east: midLon, north: midLat },
    { west: midLon, south, east, north: midLat },
    { west, south: midLat, east: midLon, north },
    { west: midLon, south: midLat, east, north },
  ];
}

async function fetchTile(bbox, depth, allNodes, allWays, stats) {
  const cached = loadTileCache(bbox);
  if (cached) {
    cached.nodes.forEach(n => allNodes.set(n.id, n));
    cached.ways.forEach(w => allWays.set(w.id, w));
    stats.tilesFetched++;
    stats.tilesFromCache++;
    return;
  }

  const url = `${OSM_API_URL}?bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
  let wait509Count = 0;

  for (let attempt = 1; attempt <= MAX_RETRIES_PER_TILE; attempt++) {
    await sleep(REQUEST_DELAY_MS);
    let res;
    try {
      res = await fetch(url, { headers: REQUEST_HEADERS });
    } catch (e) {
      console.log(`Tile ${JSON.stringify(bbox)} attempt ${attempt}/${MAX_RETRIES_PER_TILE} network error: ${e.message}`);
      if (attempt === MAX_RETRIES_PER_TILE) throw e;
      await sleep(3000);
      continue;
    }
    if (res.ok) {
      const xml = await res.text();
      const { nodes, ways } = parseOsmXml(xml);
      saveTileCache(bbox, nodes, ways);
      nodes.forEach(n => allNodes.set(n.id, n));
      ways.forEach(w => allWays.set(w.id, w));
      stats.tilesFetched++;
      return;
    }
    const body = await res.text();
    if (res.status === 400 && body.includes('too many nodes')) {
      if (depth >= MAX_SPLIT_DEPTH) {
        throw new Error(`Bbox split exceeded max depth ${MAX_SPLIT_DEPTH} at ${JSON.stringify(bbox)}`);
      }
      for (const sub of splitBbox(bbox)) {
        await fetchTile(sub, depth + 1, allNodes, allWays, stats);
      }
      return;
    }
    // ダウンロード量クォータ(509)はサーバーが明示的に待ち時間を教えてくれる
    // 自己回復型の制限なので、リトライ回数を消費せずその分だけ待って続行する。
    if (res.status === 509) {
      const waitMatch = body.match(/try again in (\d+) seconds/);
      const waitSec = waitMatch ? Number(waitMatch[1]) : 30;
      wait509Count++;
      if (wait509Count > MAX_509_WAITS) {
        throw new Error(`Tile ${JSON.stringify(bbox)}: exceeded ${MAX_509_WAITS} download-quota waits`);
      }
      console.log(`Tile ${JSON.stringify(bbox)}: download quota (509), waiting ${waitSec + 5}s...`);
      await sleep((waitSec + 5) * 1000);
      attempt--; // この試行はカウントしない
      continue;
    }
    console.log(`Tile ${JSON.stringify(bbox)} attempt ${attempt}/${MAX_RETRIES_PER_TILE} failed: HTTP ${res.status}`);
    if (attempt === MAX_RETRIES_PER_TILE) {
      throw new Error(`OSM API error for tile ${JSON.stringify(bbox)}: HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    await sleep(res.status === 429 ? 20000 : 2000);
  }
}

function initialGrid(bbox, tileSizeDeg) {
  const tiles = [];
  const cols = Math.ceil((bbox.east - bbox.west) / tileSizeDeg);
  const rows = Math.ceil((bbox.north - bbox.south) / tileSizeDeg);
  const lonStep = (bbox.east - bbox.west) / cols;
  const latStep = (bbox.north - bbox.south) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tiles.push({
        west: bbox.west + c * lonStep,
        east: bbox.west + (c + 1) * lonStep,
        south: bbox.south + r * latStep,
        north: bbox.south + (r + 1) * latStep,
      });
    }
  }
  return tiles;
}

async function fetchRoads() {
  const allNodes = new Map();
  const allWays = new Map();
  const stats = { tilesFetched: 0, tilesFromCache: 0 };

  // 久留米市全体を一度に要求するとOSM APIのサイズ based レート制限に
  // 即座に引っかかる(再試行してもコンテンツベースの400 "too many nodes"
  // に到達する前に429で拒否される)ため、最初から適度な大きさのグリッドに
  // 分割してから取得する(密集地はfetchTile内でさらに再帰分割される)。
  const tiles = initialGrid(KURUME_BBOX, 0.025);
  console.log(`Fetching ${tiles.length} initial tiles...`);
  for (const [i, tile] of tiles.entries()) {
    await fetchTile(tile, 0, allNodes, allWays, stats);
    console.log(`  [${i + 1}/${tiles.length}] done (${allNodes.size} nodes, ${allWays.size} ways so far)`);
  }
  console.log(`Fetched ${stats.tilesFetched} tiles, ${allNodes.size} raw nodes, ${allWays.size} raw ways`);

  const roadWays = [...allWays.values()].filter(w => HIGHWAY_TYPES.has(w.tags.highway));
  const usedNodeIds = new Set();
  roadWays.forEach(w => w.nodes.forEach(id => usedNodeIds.add(id)));

  const elements = [];
  for (const id of usedNodeIds) {
    const n = allNodes.get(id);
    if (n) elements.push({ type: 'node', id: n.id, lat: n.lat, lon: n.lon });
  }
  for (const w of roadWays) {
    elements.push({ type: 'way', id: w.id, nodes: w.nodes, tags: w.tags });
  }

  return { version: 0.6, elements };
}

const outPath = path.join(__dirname, '../osm_roads_raw.json');
const data = await fetchRoads();
fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
console.log(`Wrote ${data.elements.length} elements to ${outPath}`);
