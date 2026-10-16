import { describe, it, expect } from 'vitest';
import { osmWaysToRoadGraph } from './build_road_graph.js';

describe('osmWaysToRoadGraph', () => {
  it('builds a connection between endpoints, skipping a shape-only intermediate point', () => {
    const elements = [
      { type: 'node', id: 1, lat: 33.000, lon: 130.000 },
      { type: 'node', id: 2, lat: 33.001, lon: 130.001 },
      { type: 'node', id: 3, lat: 33.002, lon: 130.002 },
      { type: 'way', id: 100, nodes: [1, 2, 3], tags: { highway: 'residential' } },
    ];

    const result = osmWaysToRoadGraph(elements);

    const ids = result.stops.map(s => s.id).sort();
    expect(ids).toEqual(['1', '3']);
    const stop1 = result.stops.find(s => s.id === '1');
    const stop3 = result.stops.find(s => s.id === '3');
    expect(stop1.connectedStopIds).toEqual(['3']);
    expect(stop3.connectedStopIds).toEqual(['1']);
  });

  it('promotes a node shared between two ways to a graph node, even at a middle position', () => {
    const elements = [
      { type: 'node', id: 1, lat: 33.000, lon: 130.000 },
      { type: 'node', id: 2, lat: 33.001, lon: 130.001 },
      { type: 'node', id: 3, lat: 33.002, lon: 130.002 },
      { type: 'node', id: 4, lat: 33.003, lon: 130.000 },
      { type: 'node', id: 5, lat: 33.003, lon: 130.002 },
      { type: 'way', id: 100, nodes: [1, 2, 3], tags: { highway: 'residential' } },
      { type: 'way', id: 101, nodes: [4, 2, 5], tags: { highway: 'residential' } },
    ];

    const result = osmWaysToRoadGraph(elements);

    const ids = result.stops.map(s => s.id).sort();
    expect(ids).toEqual(['1', '2', '3', '4', '5']);
    const stop2 = result.stops.find(s => s.id === '2');
    expect(stop2.connectedStopIds.slice().sort()).toEqual(['1', '3', '4', '5']);
  });

  it('skips way-node references with no matching node element', () => {
    const elements = [
      { type: 'node', id: 1, lat: 33.000, lon: 130.000 },
      { type: 'node', id: 3, lat: 33.002, lon: 130.002 },
      // node 2 is referenced by the way but has no corresponding node element
      { type: 'way', id: 100, nodes: [1, 2, 3], tags: { highway: 'residential' } },
    ];

    expect(() => osmWaysToRoadGraph(elements)).not.toThrow();
    const result = osmWaysToRoadGraph(elements);
    const ids = result.stops.map(s => s.id).sort();
    expect(ids).toEqual(['1', '3']);
    expect(result.stops.find(s => s.id === '1').connectedStopIds).toEqual(['3']);
  });

  it('does not create a self-loop when a way revisits its own starting node', () => {
    const elements = [
      { type: 'node', id: 1, lat: 33.000, lon: 130.000 },
      { type: 'node', id: 2, lat: 33.001, lon: 130.001 },
      { type: 'node', id: 3, lat: 33.002, lon: 130.000 },
      { type: 'node', id: 4, lat: 33.003, lon: 130.003 },
      // way 100 is a short loop back to node 1; way 101 connects node 1 to node 4,
      // so node 1 is a real intersection and must still appear in the output
      { type: 'way', id: 100, nodes: [1, 2, 3, 1], tags: { highway: 'residential' } },
      { type: 'way', id: 101, nodes: [1, 4], tags: { highway: 'residential' } },
    ];

    const result = osmWaysToRoadGraph(elements);

    const stop1 = result.stops.find(s => s.id === '1');
    expect(stop1).toBeDefined();
    expect(stop1.connectedStopIds).not.toContain('1');
    expect(stop1.connectedStopIds).toContain('4');
  });
});
