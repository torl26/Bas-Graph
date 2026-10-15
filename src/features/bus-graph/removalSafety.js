import betweennessCentrality from 'graphology-metrics/centrality/betweenness';

// ===== 関節点(articulation point)判定 =====
// そのノードを削除するとグラフが分断される(孤立集団ができる)ノードを検出する。
// Tarjanのアルゴリズム(DFSの発見時刻とlow-link値を使う)。O(V+E)。
// バス停は高々数百件程度なので再帰DFSで十分(スタック深さの心配なし)。
export function findArticulationPoints(graph) {
  const visited = new Set();
  const disc = new Map();
  const low = new Map();
  const parent = new Map();
  const articulationPoints = new Set();
  let timer = 0;

  function dfs(u, isRoot) {
    visited.add(u);
    disc.set(u, timer);
    low.set(u, timer);
    timer++;
    let children = 0;

    graph.forEachNeighbor(u, v => {
      if (v === parent.get(u)) return; // 親へ戻るエッジはスキップ
      if (visited.has(v)) {
        low.set(u, Math.min(low.get(u), disc.get(v)));
      } else {
        children++;
        parent.set(v, u);
        dfs(v, false);
        low.set(u, Math.min(low.get(u), low.get(v)));
        if (!isRoot && low.get(v) >= disc.get(u)) {
          articulationPoints.add(u);
        }
      }
    });

    if (isRoot && children > 1) {
      articulationPoints.add(u);
    }
  }

  graph.forEachNode(node => {
    if (!visited.has(node)) dfs(node, true);
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

// ===== バス停ごとの削除安全度を判定する =====
// busData: { stops: [{id, name, lat, lng, connectedStopIds?}] }
// graph: buildGraphFromLocalData(busData) で構築済みのグラフ
export function assessRemovalSafety(graph, busData) {
  const articulationPoints = findArticulationPoints(graph);
  const vitality = computeVitality(graph);

  const result = {};
  busData.stops.forEach(stop => {
    const id = String(stop.id);
    if (!graph.hasNode(id)) return;

    const hasCoords = typeof stop.lat === 'number' && typeof stop.lng === 'number';

    let nearestDistance = Infinity;
    if (hasCoords) {
      busData.stops.forEach(other => {
        if (String(other.id) === id) return;
        if (typeof other.lat !== 'number' || typeof other.lng !== 'number') return;
        const d = haversineDistance(stop.lat, stop.lng, other.lat, other.lng);
        if (d < nearestDistance) nearestDistance = d;
      });
    }

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
