import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 久留米市の道路網OSM要素(node/way)から、交差点をノード・道路区間をエッジとする
// { stops: [{id, name, lat, lng, connectedStopIds}] } 形式のグラフデータに変換する。
//
// graph node(交差点)になる条件:
//   - wayの端点(最初/最後のノード)、または
//   - 2つ以上のwayに共有されているノード
// それ以外のノードは道路の形状を表す点として扱い、交差点同士を結ぶ際にスキップする。
export function osmWaysToRoadGraph(elements) {
  const nodeById = new Map();
  const ways = [];

  elements.forEach(el => {
    if (el.type === 'node') {
      nodeById.set(el.id, { lat: el.lat, lon: el.lon });
    } else if (el.type === 'way' && Array.isArray(el.nodes)) {
      ways.push(el);
    }
  });

  // 各ノードが何本のwayに現れるか数える(同じway内の重複は1回とする)
  const nodeWayCount = new Map();
  ways.forEach(way => {
    const uniqueNodeIds = new Set(way.nodes);
    uniqueNodeIds.forEach(nodeId => {
      nodeWayCount.set(nodeId, (nodeWayCount.get(nodeId) || 0) + 1);
    });
  });

  const isIntersection = (nodeId, way, index) => {
    if (index === 0 || index === way.nodes.length - 1) return true;
    return (nodeWayCount.get(nodeId) || 0) >= 2;
  };

  const graphNodeIds = new Set();
  const connections = new Map(); // nodeId -> Set(connectedNodeId)

  const addConnection = (a, b) => {
    if (a === b) return;
    graphNodeIds.add(a);
    graphNodeIds.add(b);
    if (!connections.has(a)) connections.set(a, new Set());
    if (!connections.has(b)) connections.set(b, new Set());
    connections.get(a).add(b);
    connections.get(b).add(a);
  };

  ways.forEach(way => {
    let segmentStart = null; // 直前に見つかった交差点のノードID

    for (let i = 0; i < way.nodes.length; i++) {
      const nodeId = way.nodes[i];
      if (!nodeById.has(nodeId)) continue; // 座標が無い(欠損)参照はスキップ

      if (isIntersection(nodeId, way, i)) {
        if (segmentStart !== null && segmentStart !== nodeId) {
          addConnection(segmentStart, nodeId);
        }
        segmentStart = nodeId;
      }
    }
  });

  const stops = Array.from(graphNodeIds).map(nodeId => {
    const coords = nodeById.get(nodeId);
    return {
      id: String(nodeId),
      name: null,
      lat: coords.lat,
      lng: coords.lon,
      connectedStopIds: Array.from(connections.get(nodeId) || []).map(String),
    };
  });

  return { stops };
}

// ===== CLI実行部 =====
// `node build_road_graph.js` のように直接実行された場合のみ、
// osm_roads_raw.json を読み込んで roadData.json を書き出す。
// osmWaysToRoadGraph() をテストからimportするだけではこのブロックは実行されない。
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rawPath = path.join(__dirname, '../osm_roads_raw.json');
  const outPath = path.join(__dirname, '../../roadData.json');
  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  const roadData = osmWaysToRoadGraph(raw.elements);
  fs.writeFileSync(outPath, JSON.stringify(roadData, null, 2));
  console.log(`Wrote ${roadData.stops.length} intersections to ${outPath}`);
}
