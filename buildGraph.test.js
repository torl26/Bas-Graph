import { describe, it, expect } from 'vitest';
import { buildGraphFromLocalData, scoreToColor } from './buildGraph.js';

describe('scoreToColor', () => {
  it('returns the lowest color stop at score 0', () => {
    expect(scoreToColor(0)).toBe('rgb(56,189,248)');
  });

  it('returns the highest color stop at score 1', () => {
    expect(scoreToColor(1)).toBe('rgb(249,115,22)');
  });

  it('interpolates between stops for an intermediate score', () => {
    const color = scoreToColor(0.5);
    expect(color).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    expect(color).not.toBe(scoreToColor(0));
    expect(color).not.toBe(scoreToColor(1));
  });
});

describe('buildGraphFromLocalData', () => {
  const sampleData = {
    stops: [
      { id: 1, name: 'A', lat: 33.0, lng: 130.0, connectedStopIds: [2], population: 100, populationArea: '甲' },
      { id: 2, name: 'B', lat: 33.01, lng: 130.01, connectedStopIds: [1, 3], population: 50, populationArea: '乙' },
      { id: 3, name: 'C', lat: null, lng: null, connectedStopIds: [2] }, // 座標未確定
    ],
  };

  it('creates one node per stop and one edge per unique connection', () => {
    const graph = buildGraphFromLocalData(sampleData);
    expect(graph.order).toBe(3);
    // 1-2, 2-3 の2本(相互参照分は重複させない)
    expect(graph.size).toBe(2);
  });

  it('assigns importance/size/color to every node', () => {
    const graph = buildGraphFromLocalData(sampleData);
    graph.forEachNode((node, attrs) => {
      expect(typeof attrs.importance).toBe('number');
      expect(attrs.importance).toBeGreaterThanOrEqual(0);
      expect(attrs.importance).toBeLessThanOrEqual(1);
      expect(typeof attrs.size).toBe('number');
      expect(typeof attrs.color).toBe('string');
    });
  });

  it('estimates a finite position for stops with missing coordinates', () => {
    const graph = buildGraphFromLocalData(sampleData);
    const c = graph.getNodeAttributes('3');
    expect(c.hasCoords).toBe(false);
    expect(Number.isFinite(c.x)).toBe(true);
    expect(Number.isFinite(c.y)).toBe(true);
  });

  it('treats a missing population as 0 rather than throwing', () => {
    const graph = buildGraphFromLocalData(sampleData);
    expect(graph.getNodeAttribute('3', 'population')).toBe(0);
  });

  it('does not add edges to a connectedStopIds target that does not exist', () => {
    const withDangling = {
      stops: [
        { id: 1, name: 'A', lat: 0, lng: 0, connectedStopIds: [999] },
      ],
    };
    const graph = buildGraphFromLocalData(withDangling);
    expect(graph.order).toBe(1);
    expect(graph.size).toBe(0);
  });
});
