import Graph from 'graphology';
import { degreeCentrality } from 'graphology-metrics/centrality/degree';
import betweennessCentrality from 'graphology-metrics/centrality/betweenness';
import forceAtlas2 from 'graphology-layout-forceatlas2';

// 重要度スコアをノードサイズと色にマッピング
function scoreToSize(score) {
  // 2px〜12pxの範囲にマッピング
  return 2 + score * 10;
}

// 重要度カラースケール: 青 → ティール → オリーブ黄 → オレンジ
const COLOR_STOPS = [
  [0, [56, 189, 248]],    // sky-400
  [0.35, [45, 212, 191]], // teal-400
  [0.65, [202, 138, 4]],  // amber-700 (olive)
  [1, [249, 115, 22]],    // orange-500
];

export function scoreToColor(score) {
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const [t0, c0] = COLOR_STOPS[i];
    const [t1, c1] = COLOR_STOPS[i + 1];
    if (score >= t0 && score <= t1) {
      const t = t1 === t0 ? 0 : (score - t0) / (t1 - t0);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
      return `rgb(${r},${g},${b})`;
    }
  }
  const last = COLOR_STOPS[COLOR_STOPS.length - 1][1];
  return `rgb(${last.join(',')})`;
}

// 路線ごとに色分けするためのパレット
const EDGE_PALETTE = ['#60a5fa', '#a78bfa', '#34d399', '#eab308', '#fb7185', '#fb923c', '#22d3ee', '#4ade80'];

// 系統(routes)に属さない、バス停個別のconnectionsから作るエッジの色
const CONNECTION_EDGE_COLOR = '#94a3b8'; // slate-400

function normalize(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0.5);
  return values.map(v => (v - min) / (max - min));
}

// 重要度スコアの重み付けデフォルト(次数中心性50% + 媒介中心性50%、人口重みは未使用)
const DEFAULT_WEIGHTS = { degree: 0.5, betweenness: 0.5, population: 0 };

// グラフ全体から中心性(重要度)を計算してノード属性に反映する
// weights: { degree, betweenness, population } 各0〜1。合計が1でなくても相対比率として正規化する。
function applyImportanceScores(graph, weights = DEFAULT_WEIGHTS) {
  if (graph.order === 0) return graph;

  const degree = degreeCentrality(graph);

  // 媒介中心性（ノード数が多いと重いので上限を設定）
  let betweenness = {};
  try {
    betweenness = betweennessCentrality(graph, { normalized: true });
  } catch {
    graph.forEachNode(n => { betweenness[n] = 0; });
  }

  const nodes = graph.nodes();
  const degreeVals = nodes.map(n => degree[n] ?? 0);
  const betweennessVals = nodes.map(n => betweenness[n] ?? 0);
  // バス停の地域人口(町丁目)。座標未確定などで無い場合は0(最下位)として扱う。
  const populationVals = nodes.map(n => graph.getNodeAttribute(n, 'population') ?? 0);

  const degreeNorm = normalize(degreeVals);
  const betweennessNorm = normalize(betweennessVals);
  const populationNorm = normalize(populationVals);

  // 重みの合計で正規化(スライダーの絶対値に関わらずスコアを0〜1に保つ)。
  // 全て0の場合は3指標を均等に使う。
  const totalWeight = weights.degree + weights.betweenness + weights.population;
  const w = totalWeight > 0 ? weights : { degree: 1 / 3, betweenness: 1 / 3, population: 1 / 3 };
  const denom = totalWeight > 0 ? totalWeight : 1;

  nodes.forEach((node, i) => {
    const score = (w.degree * degreeNorm[i] + w.betweenness * betweennessNorm[i] + w.population * populationNorm[i]) / denom;
    graph.setNodeAttribute(node, 'importance', score);
    graph.setNodeAttribute(node, 'size', scoreToSize(score));
    graph.setNodeAttribute(node, 'color', scoreToColor(score));
    graph.setNodeAttribute(node, 'degree', degree[node]);
    graph.setNodeAttribute(node, 'betweenness', betweenness[node]);
    graph.setNodeAttribute(node, 'population', populationVals[i]);
  });

  return graph;
}

// 自作JSON(busData.json)からグラフを構築する
// busData.json は { stops: [{id, name, lat, lng, connectedStopIds: [id,...]}] } の形式
// lat/lngはnullの場合がある(座標未調査のバス停)。その場合は接続先の座標から位置を推定して描画する。
// layout: 'geo'(実際の緯度経度で配置) | 'force'(ForceAtlas2で接続関係を基にレイアウト、エッジの交差を減らす)
export function buildGraphFromLocalData(busData, { layout = 'geo', weights } = {}) {
  const graph = new Graph({ multi: false, type: 'undirected' });
  const stopIds = new Set(busData.stops.map(s => String(s.id)));

  busData.stops.forEach(s => {
    const nodeId = String(s.id);
    const hasCoords = typeof s.lat === 'number' && typeof s.lng === 'number';
    graph.addNode(nodeId, {
      label: s.name || `停留所 ${nodeId}`,
      lat: hasCoords ? s.lat : null,
      lon: hasCoords ? s.lng : null,
      hasCoords,
      x: hasCoords ? s.lng : 0, // sigma用: 経度をX座標に(座標未確定なら後で推定)
      y: hasCoords ? s.lat : 0, // sigma用: 緯度をY座標に(sigmaはy値が大きいほど上に描画するため反転不要、上が北になる)
      size: 3,
      color: '#3b82f6',
      population: typeof s.population === 'number' ? s.population : null,
      populationArea: s.populationArea || null,
    });
  });

  // routes(存在すれば)からのエッジ。系統ごとに色分けする(現行データには無いが後方互換のため残す)
  (busData.routes || []).forEach((r, routeIndex) => {
    const edgeColor = EDGE_PALETTE[routeIndex % EDGE_PALETTE.length];
    const stops = (r.stops || []).map(String).filter(id => stopIds.has(id));
    for (let i = 0; i < stops.length - 1; i++) {
      const src = stops[i];
      const dst = stops[i + 1];
      if (src === dst) continue;
      if (!graph.hasEdge(src, dst)) {
        graph.addEdge(src, dst, { size: 1, color: edgeColor });
      }
    }
  });

  // stops[].connectedStopIdsからのエッジ（バス停間の直接接続）
  busData.stops.forEach(s => {
    const src = String(s.id);
    (s.connectedStopIds || []).forEach(targetId => {
      const dst = String(targetId);
      if (src === dst || !stopIds.has(dst)) return;
      if (!graph.hasEdge(src, dst)) {
        graph.addEdge(src, dst, { size: 1, color: CONNECTION_EDGE_COLOR });
      }
    });
  });

  // 座標未確定ノードの初期位置を埋める(force layoutでも反復計算の種として使う)
  estimateMissingPositions(graph);

  if (layout === 'force') {
    applyForceDirectedLayout(graph);
  }

  return applyImportanceScores(graph, weights);
}

// ===== ForceAtlas2による力学的レイアウト =====
// 実際の地理座標だとバス停間の接続がジグザグに交差して見づらくなるため、
// 接続関係(グラフ構造)を基にノードを再配置し、つながりの強いバス停同士を近づけて
// エッジの交差を減らす。座標(lat/lon)自体は変えず、表示位置(x/y)だけを差し替える。
function applyForceDirectedLayout(graph) {
  const settings = forceAtlas2.inferSettings(graph);
  forceAtlas2.assign(graph, { iterations: 1000, settings });
}

// ===== 座標未確定ノードの位置推定 =====
// lat/lngがnullのバス停は、接続relationshipから位置を割り出す。
// 既知座標のノードは動かさず、未知ノードだけを隣接ノードの平均位置に
// 反復して近づけていく(離散ラプラス方程式を緩和法で解く、簡易バネモデル)。
function estimateMissingPositions(graph) {
  const unknownNodes = graph.filterNodes((n, attrs) => !attrs.hasCoords);
  if (unknownNodes.length === 0) return;

  const knownNodes = graph.filterNodes((n, attrs) => attrs.hasCoords);
  let centerX = 0;
  let centerY = 0;
  knownNodes.forEach(n => {
    centerX += graph.getNodeAttribute(n, 'x');
    centerY += graph.getNodeAttribute(n, 'y');
  });
  if (knownNodes.length > 0) {
    centerX /= knownNodes.length;
    centerY /= knownNodes.length;
  }

  // 初期位置: 重心を中心に、黄金角でずらして重なりを避ける
  unknownNodes.forEach((n, i) => {
    const angle = i * 2.399963; // 黄金角(ラジアン)
    const radius = 0.01 * (1 + (i % 5));
    graph.setNodeAttribute(n, 'x', centerX + radius * Math.cos(angle));
    graph.setNodeAttribute(n, 'y', centerY + radius * Math.sin(angle));
  });

  const ITERATIONS = 60;
  for (let iter = 0; iter < ITERATIONS; iter++) {
    unknownNodes.forEach(n => {
      const neighbors = graph.neighbors(n);
      if (neighbors.length === 0) return;
      let sx = 0;
      let sy = 0;
      neighbors.forEach(m => {
        sx += graph.getNodeAttribute(m, 'x');
        sy += graph.getNodeAttribute(m, 'y');
      });
      graph.setNodeAttribute(n, 'x', sx / neighbors.length);
      graph.setNodeAttribute(n, 'y', sy / neighbors.length);
    });
  }
}

export function buildGraphFromOSM(stopElements, routeElements) {
  const graph = new Graph({ multi: false, type: 'undirected' });

  // ノードIDのSet（バス停として確認済み）
  const stopIds = new Set();

  // バス停ノードを追加
  stopElements.forEach(el => {
    if (el.type !== 'node') return;
    const nodeId = String(el.id);
    stopIds.add(nodeId);
    graph.addNode(nodeId, {
      label: el.tags?.name || el.tags?.['name:ja'] || `停留所 ${el.id}`,
      lat: el.lat,
      lon: el.lon,
      x: el.lon, // sigma用: 経度をX座標に
      y: el.lat, // sigma用: 緯度をY座標に(sigmaはy値が大きいほど上に描画するため反転不要、上が北になる)
      size: 3,
      color: '#3b82f6',
    });
  });

  // ルートからエッジを生成
  // relation の members の中から stop_position/bus_stop を順番に取り出し、
  // 隣接するバス停同士を接続する
  const routeMap = new Map(); // routeId -> stopId[]

  routeElements.forEach(el => {
    if (el.type !== 'relation') return;
    const routeStops = [];
    el.members?.forEach(m => {
      const mid = String(m.ref);
      if (stopIds.has(mid)) {
        routeStops.push(mid);
      }
    });
    if (routeStops.length > 1) {
      routeMap.set(String(el.id), routeStops);
    }
  });

  // エッジを追加（路線ごとに色分け、同じペアの場合は重複しない）
  let routeIndex = 0;
  routeMap.forEach((stops) => {
    const edgeColor = EDGE_PALETTE[routeIndex % EDGE_PALETTE.length];
    routeIndex++;
    for (let i = 0; i < stops.length - 1; i++) {
      const src = stops[i];
      const dst = stops[i + 1];
      if (src === dst) continue;
      if (!graph.hasEdge(src, dst)) {
        graph.addEdge(src, dst, { size: 1, color: edgeColor });
      }
    }
  });

  // 孤立ノード（どの路線にも属さないバス停）も削除せず表示する。
  // 重要度スコアは自然と最低値（0）になり、小さく表示される。
  return applyImportanceScores(graph);
}
