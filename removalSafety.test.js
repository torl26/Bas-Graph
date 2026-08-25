import { describe, it, expect } from 'vitest';
import Graph from 'graphology';
import { findArticulationPoints, haversineDistance, assessRemovalSafety } from './removalSafety.js';
import { buildGraphFromLocalData } from './buildGraph.js';

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
