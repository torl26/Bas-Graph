import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { SigmaContainer, useRegisterEvents, useSigma } from '@react-sigma/core';
import '@react-sigma/core/lib/style.css';
import busData from './busData.json';
import stationData from './stationData.json';
import { buildGraphFromLocalData } from './buildGraph.js';
import { assessRemovalSafety } from './removalSafety.js';

// ===== データセット定義(バス停 / 駅) =====
const DATASETS = {
  bus: {
    label: 'バス停(久留米市)',
    title: '久留米バス停 重要度グラフ',
    data: busData,
    metricLabel: '地域人口(町丁目)',
    metricUnit: '人',
    areaDesc: '久留米市 全域',
    placeholderDesc: (
      <>busData.json から久留米市のバス停と接続関係を読み込み、<br />グラフ中心性で重要度を計算して可視化します</>
    ),
  },
  station: {
    label: '駅(JR九州・地下鉄・西鉄)',
    title: 'JR九州・福岡市地下鉄・西鉄 駅 重要度グラフ',
    data: stationData,
    metricLabel: '1日平均乗車人員/乗降人員',
    metricUnit: '人',
    areaDesc: '九州全県 + 福岡市地下鉄 + 西鉄(天神大牟田線・太宰府線・甘木線・貝塚線)',
    placeholderDesc: (
      <>stationData.json からJR九州・福岡市地下鉄・西鉄の駅と路線の接続関係を読み込み、<br />グラフ中心性と乗車人員/乗降人員で重要度を計算して可視化します</>
    ),
  },
};

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

// ===== ホバー・クリックイベントハンドラ =====
function GraphEvents({ onNodeClick, onNodeHover, onStageClick }) {
  const registerEvents = useRegisterEvents();
  const sigma = useSigma();

  useEffect(() => {
    registerEvents({
      clickNode: (e) => {
        const attrs = sigma.getGraph().getNodeAttributes(e.node);
        onNodeClick({ ...attrs, id: e.node });
      },
      enterNode: (e) => {
        sigma.getGraph().setNodeAttribute(e.node, 'highlighted', true);
        onNodeHover(e.node);
      },
      leaveNode: (e) => {
        sigma.getGraph().setNodeAttribute(e.node, 'highlighted', false);
        onNodeHover(null);
      },
      clickStage: () => onStageClick(),
    });
  }, [registerEvents, sigma, onNodeClick, onNodeHover, onStageClick]);

  return null;
}

// ===== 重みスライダー =====
function WeightPanel({ weights, onChange, metricLabel }) {
  return (
    <div>
      <p style={styles.sectionTitle}>重要度の重み付け</p>
      {[
        { key: 'degree', label: '次数中心性' },
        { key: 'betweenness', label: '媒介中心性' },
        { key: 'population', label: metricLabel },
      ].map(({ key, label }) => (
        <div key={key} style={styles.weightRow}>
          <div style={styles.weightRowTop}>
            <span style={styles.weightLabel}>{label}</span>
            <span style={styles.weightValue}>{Math.round(weights[key] * 100)}</span>
          </div>
          <input
            type="range" min={0} max={100}
            value={Math.round(weights[key] * 100)}
            onChange={e => onChange(key, Number(e.target.value) / 100)}
            style={styles.sliderFull}
          />
        </div>
      ))}
    </div>
  );
}

// ===== データセット切り替え(バス停 / 駅) =====
function DatasetToggle({ datasetKey, onChange }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <p style={styles.sectionTitle}>データセット</p>
      <div style={styles.modeToggle}>
        {Object.entries(DATASETS).map(([key, d]) => (
          <button
            key={key}
            onClick={() => onChange(key)}
            style={{ ...styles.modeToggleBtn, ...(datasetKey === key ? styles.modeToggleBtnActive : {}) }}
          >
            {d.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ===== 表示モード切り替え(地図 / ネットワーク) =====
function LayoutModeToggle({ mode, onChange }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <p style={styles.sectionTitle}>表示モード</p>
      <div style={styles.modeToggle}>
        <button
          onClick={() => onChange('geo')}
          style={{ ...styles.modeToggleBtn, ...(mode === 'geo' ? styles.modeToggleBtnActive : {}) }}
        >
          地図
        </button>
        <button
          onClick={() => onChange('force')}
          style={{ ...styles.modeToggleBtn, ...(mode === 'force' ? styles.modeToggleBtnActive : {}) }}
        >
          ネットワーク
        </button>
      </div>
      <p style={styles.legendDesc}>
        {mode === 'geo'
          ? '実際の緯度経度で配置します'
          : '接続関係を基に再配置し、線の交差を減らします'}
      </p>
    </div>
  );
}

// ===== 凡例 =====
function Legend({ itemLabel }) {
  return (
    <div>
      <p style={styles.sectionTitle}>凡例</p>
      <p style={styles.legendDesc}>円の色・大きさ = 重要度スコア</p>
      <div style={styles.legendGrad} />
      <div style={styles.legendLabels}>
        <span>低</span><span>高</span>
      </div>
      <p style={{ ...styles.legendDesc, marginTop: 14 }}>円の大きさ = スコア</p>
      <div style={styles.legendDots}>
        <span style={{ ...styles.legendDot, width: 6, height: 6 }} />
        <span style={{ ...styles.legendDot, width: 11, height: 11 }} />
        <span style={{ ...styles.legendDot, width: 18, height: 18 }} />
      </div>
      <div style={styles.legendRouteRow}>
        <span style={styles.legendDash} />
        <span style={styles.legendDesc}>{itemLabel}の接続</span>
      </div>
    </div>
  );
}

// ===== データ出典・注意事項(sourceNote) =====
function SourceNote({ note }) {
  if (!note) return null;
  return (
    <details style={styles.sourceNoteBox}>
      <summary style={styles.sourceNoteSummary}>データ出典・注意事項</summary>
      <p style={styles.sourceNoteText}>{note}</p>
    </details>
  );
}

// ===== エリア概況 =====
function AreaStats({ stats, itemLabel }) {
  if (!stats) return null;
  return (
    <div style={styles.statsBox}>
      <p style={styles.statsBoxTitle}>エリア概況</p>
      <div style={styles.statsRow}>
        <span style={styles.statsKey}>対象{itemLabel}</span>
        <span style={styles.statsValue}>{stats.count}件</span>
      </div>
      <div style={styles.statsRow}>
        <span style={styles.statsKey}>平均スコア</span>
        <span style={styles.statsValue}>{stats.avg}</span>
      </div>
      <div style={styles.statsRow}>
        <span style={styles.statsKey}>高重要度(70+)</span>
        <span style={styles.statsValue}>{stats.high}件</span>
      </div>
      <div style={styles.statsRow}>
        <span style={styles.statsKey}>削除危険(関節点)</span>
        <span style={styles.statsValue}>{stats.unsafe}件</span>
      </div>
    </div>
  );
}

// ===== 重要度ランキング =====
function RankingList({ ranking, onSelect }) {
  if (!ranking.length) return null;
  return (
    <div>
      <p style={styles.sectionTitle}>重要度ランキング</p>
      <div style={styles.rankingList}>
        {ranking.map((n, i) => (
          <div key={n.id} style={styles.rankingRow} onClick={() => onSelect(n.id)}>
            <span style={styles.rankNum}>{i + 1}</span>
            <span style={{ ...styles.rankDot, background: n.color }} />
            <span style={styles.rankName}>{n.label}</span>
            <span style={styles.rankScore}>{n.score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===== 削除安全度バッジ =====
const SAFETY_STYLE = {
  safe: { label: '安全', color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  caution: { label: '注意', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  unsafe: { label: '危険', color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
};

// 危険度ランキングの並び順（危険 > 注意 > 安全、同レベル内はVitalityが高い順）
const SAFETY_LEVEL_ORDER = { unsafe: 2, caution: 1, safe: 0 };

// ===== 危険度ランキング =====
function DangerRankingList({ ranking, onSelect }) {
  if (!ranking.length) return null;
  return (
    <div>
      <p style={styles.sectionTitle}>危険度ランキング</p>
      <div style={styles.rankingList}>
        {ranking.map((n, i) => {
          const s = SAFETY_STYLE[n.level];
          return (
            <div key={n.id} style={styles.rankingRow} onClick={() => onSelect(n.id)}>
              <span style={styles.rankNum}>{i + 1}</span>
              <span style={{ ...styles.rankDot, background: s.color }} />
              <span style={styles.rankName}>{n.label}</span>
              <span style={{ ...styles.rankScore, color: s.color }}>{s.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RemovalSafety({ safety, itemLabel }) {
  if (!safety) return null;
  const s = SAFETY_STYLE[safety.level];
  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(148,163,184,0.12)' }}>
      <div style={styles.statsRow}>
        <span style={styles.statsKey}>削除安全度</span>
        <span style={{ ...styles.safetyBadge, color: s.color, background: s.bg }}>{s.label}</span>
      </div>
      <p style={styles.safetyReason}>{safety.reason}</p>
      <div style={styles.statsRow}>
        <span style={styles.statsKey}>Vitality(媒介中心性ベース)</span>
        <span style={styles.statsValue}>{(safety.vitality * 100).toFixed(2)}%</span>
      </div>
      <div style={styles.statsRow}>
        <span style={styles.statsKey}>最寄り代替{itemLabel}</span>
        <span style={styles.statsValue}>
          {Number.isFinite(safety.nearestAlternativeDistance)
            ? `${Math.round(safety.nearestAlternativeDistance)}m`
            : '-'}
        </span>
      </div>
    </div>
  );
}

// 西鉄側は「乗降人員」(乗車+降車)、JR九州・福岡市地下鉄側は「乗車人員」で単位が異なるため、
// 駅の所属路線(populationArea)に応じて表示ラベルを切り替える(単純比較を誤解させないための対応)。
function getPopulationMetricLabel(datasetKey, node) {
  if (datasetKey !== 'station') return null;
  return node.populationArea?.startsWith('西鉄') ? '1日平均乗降人員' : '1日平均乗車人員';
}

// ===== 選択ノード詳細パネル =====
function NodeDetail({ node, safety, onClose, metricLabel, datasetKey }) {
  if (!node) return null;
  const score = (node.importance * 100).toFixed(1);
  const deg = node.degree?.toFixed ? node.degree.toFixed(3) : node.degree;
  const bet = node.betweenness?.toFixed ? node.betweenness.toFixed(4) : node.betweenness;
  const populationLabel = getPopulationMetricLabel(datasetKey, node) ?? metricLabel;
  const itemLabel = datasetKey === 'station' ? '駅' : 'バス停';
  return (
    <div style={styles.statsBox}>
      <button onClick={onClose} style={styles.closeBtn}>×</button>
      <p style={styles.detailName}>{node.label}</p>
      <div style={styles.scoreBar}>
        <div style={{ ...styles.scoreBarFill, width: `${score}%`, background: node.color }} />
      </div>
      <p style={styles.scoreText}>重要度スコア: {score}</p>
      <div style={styles.statsRow}>
        <span style={styles.statsKey}>次数中心性</span>
        <span style={styles.statsValue}>{deg}</span>
      </div>
      <div style={styles.statsRow}>
        <span style={styles.statsKey}>媒介中心性</span>
        <span style={styles.statsValue}>{bet}</span>
      </div>
      <div style={styles.statsRow}>
        <span style={styles.statsKey}>{populationLabel}{node.populationArea ? `(${node.populationArea})` : ''}</span>
        <span style={styles.statsValue}>
          {typeof node.population === 'number' ? `${node.population.toLocaleString()}人` : '不明'}
        </span>
      </div>
      <div style={styles.statsRow}>
        <span style={styles.statsKey}>緯度</span>
        <span style={styles.statsValue}>{node.hasCoords ? node.lat.toFixed(5) : '不明'}</span>
      </div>
      <div style={styles.statsRow}>
        <span style={styles.statsKey}>経度</span>
        <span style={styles.statsValue}>{node.hasCoords ? node.lon.toFixed(5) : '不明'}</span>
      </div>
      <RemovalSafety safety={safety} itemLabel={itemLabel} />
    </div>
  );
}

// ===== メインアプリ =====
export default function App() {
  const [datasetKey, setDatasetKey] = useState('bus'); // 'bus' | 'station'
  const [graph, setGraph] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedNode, setSelectedNode] = useState(null);
  const [weights, setWeights] = useState({ degree: 0.5, betweenness: 0.5, population: 0 });
  const [loaded, setLoaded] = useState(false);
  const [layoutMode, setLayoutMode] = useState('geo'); // 'geo' | 'force'

  const activeDataset = DATASETS[datasetKey];
  const rawData = activeDataset.data;
  const itemLabel = datasetKey === 'station' ? '駅' : 'バス停';

  const load = useCallback(() => {
    setStatus('loading');
    setErrorMsg('');
    try {
      const g = buildGraphFromLocalData(rawData, { layout: layoutMode, weights });
      setGraph(g);
      setLoaded(true);
      setStatus('done');
    } catch (e) {
      setErrorMsg(e.message);
      setStatus('error');
    }
  }, [rawData, layoutMode, weights]);

  // 重み・表示モードが変わったら再計算（読み込み済みなら）
  useEffect(() => {
    if (!loaded) return;
    const g = buildGraphFromLocalData(rawData, { layout: layoutMode, weights });
    setGraph(g);
  }, [rawData, weights, loaded, layoutMode]);

  const handleWeightChange = (key, val) => {
    setWeights(prev => ({ ...prev, [key]: val }));
  };

  // データセット切り替え時は読込状態をリセットし、再読込を促す
  const handleDatasetChange = (key) => {
    if (key === datasetKey) return;
    setDatasetKey(key);
    setGraph(null);
    setSelectedNode(null);
    setLoaded(false);
    setStatus('idle');
    setErrorMsg('');
  };

  // ランキング・エリア概況はグラフから導出
  const ranking = useMemo(() => {
    if (!graph) return [];
    const arr = [];
    graph.forEachNode((node, attrs) => {
      arr.push({ id: node, label: attrs.label, color: attrs.color, score: Math.round(attrs.importance * 100) });
    });
    arr.sort((a, b) => b.score - a.score);
    return arr;
  }, [graph]);

  // ノードごとの削除安全度（関節点判定 + Vitality + 近隣代替ノードの有無）
  const removalSafety = useMemo(() => {
    if (!graph) return null;
    return assessRemovalSafety(graph, rawData);
  }, [graph, rawData]);

  // 危険度ランキング（危険 > 注意 > 安全、同レベル内はVitality降順）
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

  const areaStats = useMemo(() => {
    if (!ranking.length) return null;
    const avg = ranking.reduce((s, n) => s + n.score, 0) / ranking.length;
    const high = ranking.filter(n => n.score >= 70).length;
    const unsafe = removalSafety
      ? Object.values(removalSafety).filter(s => s.level === 'unsafe').length
      : 0;
    return { count: ranking.length, avg: avg.toFixed(1), high, unsafe };
  }, [ranking, removalSafety]);

  const handleSelectFromRanking = (nodeId) => {
    if (!graph) return;
    setSelectedNode({ ...graph.getNodeAttributes(nodeId), id: nodeId });
  };

  const badgeLabel = {
    idle: '未読込',
    loading: '読込中',
    done: 'ローカルデータ',
    error: 'エラー',
  }[status] ?? '読込中';

  const today = useMemo(() => new Date().toLocaleDateString('ja-JP').replace(/\//g, '-'), []);

  return (
    <div style={styles.root}>
      {/* ヘッダー */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>{activeDataset.title}</span>
        <span style={styles.badge}>{badgeLabel}</span>
        <span style={styles.headerDate}>{activeDataset.areaDesc}　|　{today} 更新</span>
        <button
          onClick={load}
          disabled={status === 'loading'}
          style={styles.loadBtn}
        >
          {status === 'loading' ? '読込中...' : 'データ読込・描画'}
        </button>
      </div>

      {/* メインエリア */}
      <div style={styles.main}>
        {/* 左サイドパネル */}
        <div style={styles.leftPanel}>
          <DatasetToggle datasetKey={datasetKey} onChange={handleDatasetChange} />
          <LayoutModeToggle mode={layoutMode} onChange={setLayoutMode} />
          <WeightPanel weights={weights} onChange={handleWeightChange} metricLabel={activeDataset.metricLabel} />
          <hr style={styles.divider} />
          <Legend itemLabel={itemLabel} />
          <SourceNote note={rawData.sourceNote} />
        </div>

        {/* グラフ本体 */}
        <div style={styles.sigmaWrapper}>
          {status === 'idle' && (
            <div style={styles.placeholder}>
              <p style={styles.placeholderTitle}>「データ読込・描画」を押してください</p>
              <p style={styles.placeholderSub}>
                {activeDataset.placeholderDesc}
              </p>
            </div>
          )}
          {status === 'loading' && (
            <div style={styles.placeholder}>
              <div style={styles.spinner} />
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
                nodeProgramClasses: {},
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
                    return {
                      ...data,
                      color: '#fef08a',
                      size: data.size + 8,
                      forceLabel: true,
                      zIndex: 1,
                    };
                  }
                  return data;
                },
              }}
            >
              <GraphEvents
                onNodeClick={attrs => setSelectedNode(attrs)}
                onNodeHover={() => {}}
                onStageClick={() => setSelectedNode(null)}
              />
            </SigmaContainer>
          )}
        </div>

        {/* 右サイドパネル */}
        <div style={styles.rightPanel}>
          <AreaStats stats={areaStats} itemLabel={itemLabel} />
          <RankingList ranking={ranking} onSelect={handleSelectFromRanking} />
          <DangerRankingList ranking={dangerRanking} onSelect={handleSelectFromRanking} />
          {selectedNode && (
            <NodeDetail
              node={selectedNode}
              safety={removalSafety?.[selectedNode.id]}
              onClose={() => setSelectedNode(null)}
              metricLabel={activeDataset.metricLabel}
              datasetKey={datasetKey}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ===== スタイル =====
const styles = {
  root: {
    display: 'flex', flexDirection: 'column',
    height: '100vh', width: '100vw',
    background: '#0b0f19', color: '#e2e8f0',
    fontFamily: 'system-ui, sans-serif', fontSize: 13,
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '18px 28px',
    flexShrink: 0,
  },
  headerTitle: { fontWeight: 700, fontSize: 19, color: '#f8fafc' },
  badge: {
    background: 'rgba(217,119,6,0.15)',
    border: '1px solid rgba(217,119,6,0.5)',
    color: '#fbbf24',
    borderRadius: 4,
    padding: '3px 10px',
    fontSize: 12, fontWeight: 500,
  },
  headerDate: { marginLeft: 'auto', color: '#64748b', fontSize: 13 },
  loadBtn: {
    padding: '6px 16px',
    background: '#3b82f6', color: '#fff',
    border: 'none', borderRadius: 6,
    cursor: 'pointer', fontWeight: 500, fontSize: 13,
  },
  main: { display: 'flex', flex: 1, overflow: 'hidden' },

  leftPanel: {
    width: 300, flexShrink: 0,
    borderRight: '1px solid rgba(148,163,184,0.12)',
    padding: 24,
    overflowY: 'auto',
  },
  rightPanel: {
    width: 320, flexShrink: 0,
    borderLeft: '1px solid rgba(148,163,184,0.12)',
    padding: 24,
    overflowY: 'auto',
    display: 'flex', flexDirection: 'column', gap: 20,
  },

  sectionTitle: {
    margin: '0 0 16px', fontWeight: 600,
    fontSize: 13, color: '#cbd5e1',
  },
  weightRow: { marginBottom: 20 },
  weightRowTop: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    marginBottom: 8,
  },
  weightLabel: { fontSize: 13, color: '#cbd5e1' },
  weightValue: { fontSize: 13, color: '#60a5fa', fontWeight: 700 },
  sliderFull: { width: '100%', accentColor: '#60a5fa' },

  modeToggle: {
    display: 'flex', gap: 6, marginBottom: 8,
  },
  modeToggleBtn: {
    flex: 1, padding: '6px 0', fontSize: 12.5, fontWeight: 500,
    background: 'rgba(255,255,255,0.03)', color: '#94a3b8',
    border: '1px solid rgba(148,163,184,0.15)', borderRadius: 6,
    cursor: 'pointer',
  },
  modeToggleBtnActive: {
    background: 'rgba(59,130,246,0.15)', color: '#60a5fa',
    border: '1px solid rgba(96,165,250,0.5)',
  },

  divider: {
    border: 'none', borderTop: '1px solid rgba(148,163,184,0.12)',
    margin: '20px 0',
  },

  legendDesc: { margin: '0 0 10px', fontSize: 12, color: '#64748b' },
  legendGrad: {
    height: 10, borderRadius: 5,
    background: 'linear-gradient(to right, #38bdf8, #2dd4bf, #ca8a04, #f97316)',
  },
  legendLabels: {
    display: 'flex', justifyContent: 'space-between',
    fontSize: 11, color: '#64748b', marginTop: 4,
  },
  legendDots: {
    display: 'flex', alignItems: 'center', gap: 10,
  },
  legendDot: {
    borderRadius: '50%', background: '#94a3b8', display: 'inline-block',
  },
  legendRouteRow: {
    display: 'flex', alignItems: 'center', gap: 8, marginTop: 16,
  },
  legendDash: {
    width: 28, height: 0,
    borderTop: '2px dashed #64748b',
    display: 'inline-block',
  },

  sourceNoteBox: {
    marginTop: 20, paddingTop: 16,
    borderTop: '1px solid rgba(148,163,184,0.12)',
  },
  sourceNoteSummary: {
    cursor: 'pointer', fontSize: 12, fontWeight: 600,
    color: '#94a3b8', userSelect: 'none',
  },
  sourceNoteText: {
    marginTop: 10, fontSize: 11, lineHeight: 1.7,
    color: '#64748b', whiteSpace: 'pre-wrap',
    maxHeight: 260, overflowY: 'auto',
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
  spinner: {
    width: 36, height: 36,
    border: '3px solid #334155',
    borderTop: '3px solid #3b82f6',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },

  statsBox: {
    background: 'rgba(255,255,255,0.02)', borderRadius: 8,
    padding: 16, border: '1px solid rgba(148,163,184,0.15)',
    position: 'relative',
  },
  statsBoxTitle: {
    margin: '0 0 12px', fontWeight: 600,
    fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em',
  },
  statsRow: {
    display: 'flex', justifyContent: 'space-between',
    padding: '5px 0', borderBottom: '1px solid rgba(148,163,184,0.08)',
  },
  statsKey: { color: '#94a3b8', fontSize: 12 },
  statsValue: { color: '#f1f5f9', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' },

  safetyBadge: {
    fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
  },
  safetyReason: { margin: '4px 0 8px', fontSize: 11.5, color: '#94a3b8', lineHeight: 1.5 },

  rankingList: {
    display: 'flex', flexDirection: 'column',
    maxHeight: 320, overflowY: 'auto',
  },
  rankingRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '7px 0', borderBottom: '1px solid rgba(148,163,184,0.06)',
    cursor: 'pointer',
  },
  rankNum: { width: 16, color: '#64748b', fontSize: 12, textAlign: 'right' },
  rankDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  rankName: { flex: 1, color: '#e2e8f0', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rankScore: { color: '#f1f5f9', fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' },

  closeBtn: {
    position: 'absolute', top: 12, right: 12,
    background: 'none', border: 'none',
    color: '#64748b', cursor: 'pointer', fontSize: 14,
  },
  detailName: {
    margin: '0 0 10px', fontWeight: 600,
    fontSize: 13, color: '#f1f5f9',
    paddingRight: 16,
  },
  scoreBar: {
    height: 6, borderRadius: 3,
    background: '#1e293b', marginBottom: 4, overflow: 'hidden',
  },
  scoreBarFill: { height: '100%', borderRadius: 3, transition: 'width 0.3s' },
  scoreText: { margin: '0 0 10px', fontSize: 12, color: '#94a3b8' },
};
