import betweennessCentrality from 'graphology-metrics/centrality/betweenness';
import { BETWEENNESS_NODE_THRESHOLD } from './buildGraph.js';

// ===== 関節点(articulation point)判定 =====
// そのノードを削除するとグラフが分断される(孤立集団ができる)ノードを検出する。
// Tarjanのアルゴリズム(DFSの発見時刻とlow-link値を使う)。O(V+E)。
// 道路交差点網(数万ノード規模)では、長い直線道路がそのまま深いDFS木になり
// 再帰呼び出しがJSのコールスタック上限を超えてクラッシュする
// (RangeError: Maximum call stack size exceeded、32,803ノードの実データで確認済み)。
// そのため明示的なスタックを使った反復DFSで実装する(ロジックは再帰版と同一)。
export function findArticulationPoints(graph) {
  const visited = new Set();
  const disc = new Map();
  const low = new Map();
  const parent = new Map();
  const articulationPoints = new Set();
  let timer = 0;

  graph.forEachNode(start => {
    if (visited.has(start)) return;

    visited.add(start);
    disc.set(start, timer);
    low.set(start, timer);
    timer++;

    const stack = [{ node: start, neighbors: graph.neighbors(start), idx: 0, children: 0, isRoot: true }];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const u = frame.node;

      if (frame.idx < frame.neighbors.length) {
        const v = frame.neighbors[frame.idx];
        frame.idx++;
        if (v === parent.get(u)) continue; // 親へ戻るエッジはスキップ
        if (visited.has(v)) {
          low.set(u, Math.min(low.get(u), disc.get(v)));
        } else {
          frame.children++;
          visited.add(v);
          parent.set(v, u);
          disc.set(v, timer);
          low.set(v, timer);
          timer++;
          stack.push({ node: v, neighbors: graph.neighbors(v), idx: 0, children: 0, isRoot: false });
        }
      } else {
        stack.pop();
        if (stack.length > 0) {
          const parentFrame = stack[stack.length - 1];
          const p = parentFrame.node;
          low.set(p, Math.min(low.get(p), low.get(u)));
          // isRootは親(p)側の判定でなければならない(子uは常にisRoot=false)
          if (!parentFrame.isRoot && low.get(u) >= disc.get(p)) {
            articulationPoints.add(p);
          }
        } else if (frame.isRoot && frame.children > 1) {
          articulationPoints.add(u);
        }
      }
    }
  });

  return articulationPoints;
}

// ===== Vitality(バス停除去の影響度合い) =====
// そのバス停を実際に取り除いてグラフ全体の効率性を再計算する方式は
// O(ノード数^2 × (V+E)) と重く、バス停が数百件規模になると描画がフリーズしてしまう。
// そのため、1回のBrandesのアルゴリズム(O(V×(V+E)))で計算できる正規化媒介中心性
// (＝全ペア間最短経路のうちそのバス停を経由する割合)をVitalityの指標として使う。
// 値が大きいほど「多くの経路がこのバス停を経由している」＝削除の影響が大きい。
export function computeVitality(graph) {
  // ノード数が多いと重いので上限を設定(BETWEENNESS_NODE_THRESHOLDの説明を参照)。
  // 超える場合は関節点判定(高速)のみでVitality=0として扱う。
  if (graph.order > BETWEENNESS_NODE_THRESHOLD) {
    const vitality = {};
    graph.forEachNode(n => { vitality[n] = 0; });
    return vitality;
  }
  try {
    return betweennessCentrality(graph, { normalized: true });
  } catch {
    const vitality = {};
    graph.forEachNode(n => { vitality[n] = 0; });
    return vitality;
  }
}

// ===== 2点間の距離(メートル、Haversine公式) =====
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 徒歩での代替可能性を判定する閾値(メートル)。これより近くに他のバス停があれば代替可能とみなす。
const NEARBY_ALTERNATIVE_RADIUS_M = 400;
// Vitality(正規化媒介中心性)がこの値以上なら「注意」とする閾値
const VITALITY_CAUTION_THRESHOLD = 0.02;

// ===== 最寄り代替拠点探索用の空間グリッドインデックス =====
// 全ペア総当たり(O(拠点数^2))はバス停(数百件)では問題にならないが、
// 道路交差点(数万件)では致命的に遅くなる(ブラウザタブがフリーズする)。
// 緯度経度を固定サイズのグリッドセルに分け、見つかった最短距離が
// 「既に調べ終えた範囲の外側は確実にそれより遠い」と言える距離を
// 上回るまでリング状に探索範囲を広げていく(expanding ring search)。
//
// セルサイズは半径(NEARBY_ALTERNATIVE_RADIUS_M)以上をカバーするよう、
// 経度1度あたりの距離(データ中で最も極に近い緯度で最小になる。
// 緯度1度あたりの距離は常にそれより大きいので、この値を使えば
// どの点についても1セル=半径以上を安全側に保証できる)を基準に計算する。
// この保証があるため、「ringまで調べ終えた」時点で、まだ調べていない
// セルにある点は必ず ring×radiusMeters より遠い、と言い切れる
// (以前の実装は3x3固定で打ち切っていたため、半径を超えた位置にしか
// 他の拠点がない疎なデータ(バス停・駅)で本来の最近傍を見逃し、
// Infinityを返してしまっていた)。
function buildSpatialGrid(points, radiusMeters, allLatDegs) {
  const mostPolarLatDeg = allLatDegs.reduce((max, lat) => Math.max(max, Math.abs(lat)), 0);
  const metersPerDegreeLon = 111320 * Math.cos((mostPolarLatDeg * Math.PI) / 180);
  const cellSizeDeg = radiusMeters / Math.max(metersPerDegreeLon, 1);
  const grid = new Map();
  let minCx = Infinity, maxCx = -Infinity, minCy = Infinity, maxCy = -Infinity;
  points.forEach(p => {
    const cx = Math.floor(p.lng / cellSizeDeg);
    const cy = Math.floor(p.lat / cellSizeDeg);
    const key = `${cx},${cy}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(p);
    minCx = Math.min(minCx, cx); maxCx = Math.max(maxCx, cx);
    minCy = Math.min(minCy, cy); maxCy = Math.max(maxCy, cy);
  });
  // データ全体を覆うのに十分なリング数(=セル座標の実際の広がり。絶対座標の
  // 大きさ(経度130度相当で3万超のセル番号になる)ではなく、点群同士の
  // 相対的な広がりを使う。どんなに離れた2点でも、この回数リングを広げれば
  // 必ずどちらかのセルに到達する)。打ち切り安全装置であり、通常は見つかった
  // 最短距離による早期終了(下記)の方が先に効く。
  const maxPossibleRings = Number.isFinite(minCx) ? Math.max(maxCx - minCx, maxCy - minCy) + 1 : 0;
  return { grid, cellSizeDeg, radiusMeters, maxPossibleRings };
}

// セル(cx,cy)を中心としたring番目の外周セル(一辺2*ring+1の正方形の輪郭)の
// 座標を直接列挙する。ring=0は中心セルのみ。O(ring)(全探索+スキップだと
// O(ring^2)になり、広い範囲のリングが必要な疎なデータで致命的に遅くなる)。
function* ringCells(cx, cy, ring) {
  if (ring === 0) {
    yield [cx, cy];
    return;
  }
  for (let dx = -ring; dx <= ring; dx++) {
    yield [cx + dx, cy - ring];
    yield [cx + dx, cy + ring];
  }
  for (let dy = -ring + 1; dy <= ring - 1; dy++) {
    yield [cx - ring, cy + dy];
    yield [cx + ring, cy + dy];
  }
}

function nearestOtherDistance(point, index) {
  const { grid, cellSizeDeg, radiusMeters, maxPossibleRings } = index;
  const cx = Math.floor(point.lng / cellSizeDeg);
  const cy = Math.floor(point.lat / cellSizeDeg);
  let nearest = Infinity;

  for (let ring = 0; ring <= maxPossibleRings; ring++) {
    for (const [gx, gy] of ringCells(cx, cy, ring)) {
      const bucket = grid.get(`${gx},${gy}`);
      if (!bucket) continue;
      for (const other of bucket) {
        if (other.id === point.id) continue;
        const d = haversineDistance(point.lat, point.lng, other.lat, other.lng);
        if (d < nearest) nearest = d;
      }
    }
    // ring番目まで調べ終えた時点で、未探索のセルにある点は必ず
    // ring×radiusMeters より遠い。見つかった最短距離がそれを下回って
    // いれば、これ以上広げても更新されないので打ち切ってよい。
    if (nearest <= ring * radiusMeters) break;
  }

  return nearest;
}

// ===== バス停ごとの削除安全度を判定する =====
// busData: { stops: [{id, name, lat, lng, connectedStopIds?}] }
// graph: buildGraphFromLocalData(busData) で構築済みのグラフ
export function assessRemovalSafety(graph, busData) {
  const articulationPoints = findArticulationPoints(graph);
  const vitality = computeVitality(graph);

  const pointsWithCoords = busData.stops
    .filter(s => typeof s.lat === 'number' && typeof s.lng === 'number')
    .map(s => ({ id: String(s.id), lat: s.lat, lng: s.lng }));
  const spatialIndex = buildSpatialGrid(pointsWithCoords, NEARBY_ALTERNATIVE_RADIUS_M, pointsWithCoords.map(p => p.lat));

  const result = {};
  busData.stops.forEach(stop => {
    const id = String(stop.id);
    if (!graph.hasNode(id)) return;

    const hasCoords = typeof stop.lat === 'number' && typeof stop.lng === 'number';
    const nearestDistance = hasCoords
      ? nearestOtherDistance({ id, lat: stop.lat, lng: stop.lng }, spatialIndex)
      : Infinity;

    const isArticulation = articulationPoints.has(id);
    const v = vitality[id] ?? 0;
    const hasNearbyAlternative = hasCoords && nearestDistance <= NEARBY_ALTERNATIVE_RADIUS_M;

    let level;
    let reason;
    if (isArticulation) {
      level = 'unsafe';
      reason = '削除するとネットワークが分断される';
    } else if (v >= VITALITY_CAUTION_THRESHOLD) {
      level = 'caution';
      reason = `多くの経路がこのバス停を経由している(Vitality ${(v * 100).toFixed(1)}%)`;
    } else if (!hasCoords) {
      level = 'caution';
      reason = '座標が未登録のため、近隣バス停との重複を判定できない';
    } else if (!hasNearbyAlternative) {
      level = 'caution';
      reason = `${NEARBY_ALTERNATIVE_RADIUS_M}m以内に代替バス停がない`;
    } else {
      level = 'safe';
      reason = '代替バス停があり、削除の影響は小さい';
    }

    result[id] = {
      level, // 'safe' | 'caution' | 'unsafe'
      reason,
      isArticulation,
      vitality: v,
      hasCoords,
      nearestAlternativeDistance: hasCoords ? nearestDistance : null,
    };
  });

  return result;
}
