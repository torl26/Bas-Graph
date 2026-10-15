import { describe, it, expect } from 'vitest';
import Graph from 'graphology';
import { findArticulationPoints, haversineDistance, assessRemovalSafety, computeVitality } from './removalSafety.js';
import { buildGraphFromLocalData, BETWEENNESS_NODE_THRESHOLD } from './buildGraph.js';

describe('findArticulationPoints', () => {
  it('flags the middle node of a path graph as an articulation point', () => {
    const graph = new Graph({ type: 'undirected' });
    graph.addNode('A');
    graph.addNode('B');
    graph.addNode('C');
    graph.addEdge('A', 'B');
    graph.addEdge('B', 'C');

    const points = findArticulationPoints(graph);
    expect(points.has('B')).toBe(true);
    expect(points.has('A')).toBe(false);
    expect(points.has('C')).toBe(false);
  });

  it('does not crash on a long chain (deep DFS, road-network scale)', () => {
    // 実データ(32,803交差点)で再帰DFS版がスタックオーバーフローした
    // ("Maximum call stack size exceeded")のを受けた回帰テスト。
    // 直線道路1本でも、交差点が無ければグラフ上はA-B-C-...の長い1本道になり、
    // DFSの深さがノード数と同じになる。
    const graph = new Graph({ type: 'undirected' });
    const N = 50000;
    for (let i = 0; i < N; i++) graph.addNode(String(i));
    for (let i = 0; i < N - 1; i++) graph.addEdge(String(i), String(i + 1));

    let points;
    expect(() => { points = findArticulationPoints(graph); }).not.toThrow();
    // 両端以外の全ノードが関節点(削除すると分断される)
    expect(points.size).toBe(N - 2);
    expect(points.has('0')).toBe(false);
    expect(points.has(String(N - 1))).toBe(false);
    expect(points.has(String(Math.floor(N / 2)))).toBe(true);
  });

  it('finds no articulation points in a triangle (cycle)', () => {
    const graph = new Graph({ type: 'undirected' });
    graph.addNode('A');
    graph.addNode('B');
    graph.addNode('C');
    graph.addEdge('A', 'B');
    graph.addEdge('B', 'C');
    graph.addEdge('C', 'A');

    expect(findArticulationPoints(graph).size).toBe(0);
  });
});

describe('haversineDistance', () => {
  it('returns 0 for identical points', () => {
    expect(haversineDistance(33.0, 130.0, 33.0, 130.0)).toBe(0);
  });

  it('approximates ~111km for 1 degree of latitude', () => {
    const d = haversineDistance(0, 0, 1, 0);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
});

describe('assessRemovalSafety', () => {
  // A-B-C-D の直線(BとCが橋、削除すると分断される)に、Dのすぐ近くにE(代替あり)を追加
  const busData = {
    stops: [
      { id: 1, name: 'A', lat: 33.000, lng: 130.000, connectedStopIds: [2] },
      { id: 2, name: 'B', lat: 33.001, lng: 130.000, connectedStopIds: [1, 3] },
      { id: 3, name: 'C', lat: 33.002, lng: 130.000, connectedStopIds: [2, 4] },
      { id: 4, name: 'D', lat: 33.003, lng: 130.000, connectedStopIds: [3, 5] },
      { id: 5, name: 'E', lat: 33.0031, lng: 130.000, connectedStopIds: [4] }, // Dのすぐ近く(代替可能)
    ],
  };

  it('marks a bridge stop (articulation point) as unsafe', () => {
    const graph = buildGraphFromLocalData(busData);
    const safety = assessRemovalSafety(graph, busData);
    expect(safety['2'].level).toBe('unsafe');
    expect(safety['2'].isArticulation).toBe(true);
  });

  it('marks a stop with a very close alternative and low vitality as safe', () => {
    const graph = buildGraphFromLocalData(busData);
    const safety = assessRemovalSafety(graph, busData);
    expect(safety['5'].isArticulation).toBe(false);
    expect(safety['5'].nearestAlternativeDistance).toBeLessThan(400);
  });

  it('finds a nearby alternative even when it falls in an adjacent spatial-grid cell', () => {
    // 空間グリッド(半径400m換算のセルサイズ、緯度33度)の境界を挟んで
    // 1.9mしか離れていない2点。セル内総当たりだけでは互いに見つからず、
    // 3x3近傍セルの探索が実装されていることを確認する回帰テスト。
    const nearBoundary = {
      stops: [
        { id: 1, name: 'A', lat: 33.000, lng: 130.0031498797023, connectedStopIds: [2] },
        { id: 2, name: 'B', lat: 33.000, lng: 130.0031698797023, connectedStopIds: [1] },
      ],
    };
    const graph = buildGraphFromLocalData(nearBoundary);
    const safety = assessRemovalSafety(graph, nearBoundary);
    expect(safety['1'].nearestAlternativeDistance).toBeLessThan(5);
    expect(safety['1'].level).toBe('safe');
  });

  it('marks stops with missing coordinates as caution', () => {
    const withMissingCoords = {
      stops: [
        { id: 1, name: 'A', lat: 33.0, lng: 130.0, connectedStopIds: [2] },
        { id: 2, name: 'B', lat: null, lng: null, connectedStopIds: [1] },
      ],
    };
    const graph = buildGraphFromLocalData(withMissingCoords);
    const safety = assessRemovalSafety(graph, withMissingCoords);
    expect(safety['2'].hasCoords).toBe(false);
    expect(safety['2'].level).toBe('caution');
  });
});

describe('computeVitality', () => {
  it('skips the expensive betweenness-centrality computation above BETWEENNESS_NODE_THRESHOLD, returning 0 for every node', () => {
    // buildGraph.test.jsの同名テストと対になる回帰テスト。久留米市道路網の実データ
    // (32,803ノード)でcomputeVitalityが約161分かかることを確認済み。
    const N = BETWEENNESS_NODE_THRESHOLD + 1;
    const graph = new Graph({ type: 'undirected' });
    for (let i = 0; i < N; i++) graph.addNode(String(i));
    for (let i = 1; i < N; i++) graph.addEdge('0', String(i)); // 星形(中心0番、媒介中心性なら突出するはずの構造)

    const t0 = Date.now();
    const vitality = computeVitality(graph);
    const elapsedMs = Date.now() - t0;

    expect(vitality['0']).toBe(0);
    expect(vitality['1']).toBe(0);
    expect(elapsedMs).toBeLessThan(5000);
  });
});
