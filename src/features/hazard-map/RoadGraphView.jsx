import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { SigmaContainer, useRegisterEvents, useSigma } from '@react-sigma/core';
import '@react-sigma/core/lib/style.css';
import roadData from '../../data/roadData.json';
import { buildGraphFromLocalData } from '../../shared/graphAnalysis/buildGraph.js';
import { assessRemovalSafety } from '../../shared/graphAnalysis/removalSafety.js';

// ===== ホバー時のみ表示するラベル（背景ボックス付き） =====
function drawHoverLabel(context, data, settings) {
  if (!data.label) return;
  const size = settings.labelSize;
  const font = settings.labelFont;
  const weight = settings.labelWeight;
  context.font = `${weight} ${size}px ${font}`;

  const paddingX = 5, paddingY = 3;
  const textWidth = context.measureText(data.label).width;
  const boxX = data.x + data.size + 4;
  const boxY = data.y - size / 2 - paddingY;
  const boxWidth = textWidth + paddingX * 2;
  const boxHeight = size + paddingY * 2;

  context.fillStyle = 'rgba(11,15,25,0.82)';
  context.beginPath();
  if (context.roundRect) {
    context.roundRect(boxX - paddingX, boxY, boxWidth, boxHeight, 4);
  } else {
    context.rect(boxX - paddingX, boxY, boxWidth, boxHeight);
  }
  context.fill();

  context.fillStyle = '#f8fafc';
  context.fillText(data.label, boxX, data.y + size / 3);
}

function GraphEvents({ onNodeClick, onStageClick }) {
  const registerEvents = useRegisterEvents();
  const sigma = useSigma();

  useEffect(() => {
    registerEvents({
      clickNode: (e) => {
        const attrs = sigma.getGraph().getNodeAttributes(e.node);
        onNodeClick({ ...attrs, id: e.node });
      },
      clickStage: () => onStageClick(),
    });
  }, [registerEvents, sigma, onNodeClick, onStageClick]);

  return null;
}

const SAFETY_STYLE = {
  safe: { label: '安全', color: '#4ade80' },
  caution: { label: '注意', color: '#fbbf24' },
  unsafe: { label: '危険', color: '#f87171' },
};
const SAFETY_LEVEL_ORDER = { unsafe: 2, caution: 1, safe: 0 };

export default function RoadGraphView() {
  const [graph, setGraph] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedNode, setSelectedNode] = useState(null);

  const load = useCallback(() => {
    setStatus('loading');
    setErrorMsg('');
    try {
      const g = buildGraphFromLocalData(roadData, { layout: 'geo' });
      setGraph(g);
      setStatus('done');
    } catch (e) {
      setErrorMsg(e.message);
      setStatus('error');
    }
  }, []);

  const removalSafety = useMemo(() => {
    if (!graph) return null;
    return assessRemovalSafety(graph, roadData);
  }, [graph]);

  const ranking = useMemo(() => {
    if (!graph) return [];
    const arr = [];
    graph.forEachNode((node, attrs) => {
      arr.push({ id: node, label: attrs.label, color: attrs.color, score: Math.round(attrs.importance * 100) });
    });
    arr.sort((a, b) => b.score - a.score);
    return arr;
  }, [graph]);

  const dangerRanking = useMemo(() => {
    if (!graph || !removalSafety) return [];
    const arr = [];
    graph.forEachNode((node, attrs) => {
      const safety = removalSafety[node];
      if (!safety) return;
      arr.push({ id: node, label: attrs.label, level: safety.level, vitality: safety.vitality });
    });
    arr.sort((a, b) => SAFETY_LEVEL_ORDER[b.level] - SAFETY_LEVEL_ORDER[a.level] || b.vitality - a.vitality);
    return arr;
  }, [graph, removalSafety]);

  const handleSelectFromRanking = (nodeId) => {
    if (!graph) return;
    setSelectedNode({ ...graph.getNodeAttributes(nodeId), id: nodeId });
  };

  const badgeLabel = {
    idle: '未読込',
    loading: '読込中',
    done: graph ? `${graph.order}交差点` : '読込済',
    error: 'エラー',
  }[status] ?? '読込中';

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>久留米市 道路網グラフ（ハザードマップ基盤）</span>
        <span style={styles.badge}>{badgeLabel}</span>
        <button onClick={load} disabled={status === 'loading'} style={styles.loadBtn}>
          {status === 'loading' ? '読込中...' : 'データ読込・描画'}
        </button>
      </div>

      <div style={styles.main}>
        <div style={styles.leftPanel}>
          <p style={styles.sectionTitle}>凡例</p>
          <p style={styles.legendDesc}>円の色・大きさ = 重要度スコア（次数中心性・媒介中心性）</p>
          <div style={styles.legendGrad} />
          <div style={styles.legendLabels}><span>低</span><span>高</span></div>
        </div>

        <div style={styles.sigmaWrapper}>
          {status === 'idle' && (
            <div style={styles.placeholder}>
              <p style={styles.placeholderTitle}>「データ読込・描画」を押してください</p>
              <p style={styles.placeholderSub}>
                roadData.json から道路交差点ネットワークを読み込み、<br />
                重要度・削除安全度を可視化します
              </p>
            </div>
          )}
          {status === 'loading' && (
            <div style={styles.placeholder}>
              <p style={styles.placeholderSub}>読込中...</p>
            </div>
          )}
          {status === 'error' && (
            <div style={styles.placeholder}>
              <p style={{ color: '#ef4444', fontWeight: 500 }}>エラー: {errorMsg}</p>
              <button onClick={load} style={styles.loadBtn}>再試行</button>
            </div>
          )}
          {status === 'done' && graph && (
            <SigmaContainer
              graph={graph}
              style={{ width: '100%', height: '100%', background: 'transparent' }}
              settings={{
                defaultNodeColor: '#3b82f6',
                defaultEdgeColor: '#334155',
                renderLabels: false,
                labelFont: 'system-ui, sans-serif',
                labelSize: 12,
                labelWeight: '600',
                labelColor: { color: '#f8fafc' },
                defaultDrawNodeHover: drawHoverLabel,
                minEdgeThickness: 0.5,
                maxEdgeThickness: 2,
                renderEdgeLabels: false,
                enableEdgeEvents: false,
                nodeReducer: (node, data) => {
                  if (selectedNode && node === selectedNode.id) {
                    return { ...data, color: '#fef08a', size: data.size + 8, forceLabel: true, zIndex: 1 };
                  }
                  return data;
                },
              }}
            >
              <GraphEvents
                onNodeClick={attrs => setSelectedNode(attrs)}
                onStageClick={() => setSelectedNode(null)}
              />
            </SigmaContainer>
          )}
        </div>

        <div style={styles.rightPanel}>
          {ranking.length > 0 && (
            <div>
              <p style={styles.sectionTitle}>重要度ランキング</p>
              <div style={styles.rankingList}>
                {ranking.slice(0, 15).map((n, i) => (
                  <div key={n.id} style={styles.rankingRow} onClick={() => handleSelectFromRanking(n.id)}>
                    <span style={styles.rankNum}>{i + 1}</span>
                    <span style={{ ...styles.rankDot, background: n.color }} />
                    <span style={styles.rankName}>{n.label}</span>
                    <span style={styles.rankScore}>{n.score}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {dangerRanking.length > 0 && (
            <div>
              <p style={styles.sectionTitle}>危険度ランキング（関節点・Vitality）</p>
              <div style={styles.rankingList}>
                {dangerRanking.slice(0, 15).map((n, i) => {
                  const s = SAFETY_STYLE[n.level];
                  return (
                    <div key={n.id} style={styles.rankingRow} onClick={() => handleSelectFromRanking(n.id)}>
                      <span style={styles.rankNum}>{i + 1}</span>
                      <span style={{ ...styles.rankDot, background: s.color }} />
                      <span style={styles.rankName}>{n.label}</span>
                      <span style={{ ...styles.rankScore, color: s.color }}>{s.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  root: {
    display: 'flex', flexDirection: 'column',
    height: '100vh', width: '100vw',
    background: '#0b0f19', color: '#e2e8f0',
    fontFamily: 'system-ui, sans-serif', fontSize: 13,
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '18px 28px', flexShrink: 0,
  },
  headerTitle: { fontWeight: 700, fontSize: 19, color: '#f8fafc' },
  badge: {
    background: 'rgba(217,119,6,0.15)',
    border: '1px solid rgba(217,119,6,0.5)',
    color: '#fbbf24', borderRadius: 4,
    padding: '3px 10px', fontSize: 12, fontWeight: 500,
  },
  loadBtn: {
    marginLeft: 'auto', padding: '6px 16px',
    background: '#3b82f6', color: '#fff',
    border: 'none', borderRadius: 6,
    cursor: 'pointer', fontWeight: 500, fontSize: 13,
  },
  main: { display: 'flex', flex: 1, overflow: 'hidden' },
  leftPanel: {
    width: 260, flexShrink: 0,
    borderRight: '1px solid rgba(148,163,184,0.12)',
    padding: 24, overflowY: 'auto',
  },
  rightPanel: {
    width: 320, flexShrink: 0,
    borderLeft: '1px solid rgba(148,163,184,0.12)',
    padding: 24, overflowY: 'auto',
    display: 'flex', flexDirection: 'column', gap: 20,
  },
  sectionTitle: { margin: '0 0 16px', fontWeight: 600, fontSize: 13, color: '#cbd5e1' },
  legendDesc: { margin: '0 0 10px', fontSize: 12, color: '#64748b' },
  legendGrad: {
    height: 10, borderRadius: 5,
    background: 'linear-gradient(to right, #38bdf8, #2dd4bf, #ca8a04, #f97316)',
  },
  legendLabels: {
    display: 'flex', justifyContent: 'space-between',
    fontSize: 11, color: '#64748b', marginTop: 4,
  },
  sigmaWrapper: {
    flex: 1, position: 'relative',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#0b0f19',
    backgroundImage:
      'linear-gradient(rgba(148,163,184,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.07) 1px, transparent 1px)',
    backgroundSize: '40px 40px',
  },
  placeholder: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 12,
    color: '#64748b', textAlign: 'center',
  },
  placeholderTitle: { fontSize: 16, fontWeight: 500, color: '#94a3b8', margin: 0 },
  placeholderSub: { fontSize: 13, lineHeight: 1.7, margin: 0, color: '#475569' },
  rankingList: { display: 'flex', flexDirection: 'column', maxHeight: 320, overflowY: 'auto' },
  rankingRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '7px 0', borderBottom: '1px solid rgba(148,163,184,0.06)',
    cursor: 'pointer',
  },
  rankNum: { width: 16, color: '#64748b', fontSize: 12, textAlign: 'right' },
  rankDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  rankName: { flex: 1, color: '#e2e8f0', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rankScore: { color: '#f1f5f9', fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
};
