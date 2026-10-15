import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './features/bus-graph/App.jsx';
import RoadGraphView from './features/hazard-map/RoadGraphView.jsx';

// スピナーアニメーション
const style = document.createElement('style');
style.textContent = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { overflow: hidden; }
  @keyframes spin { to { transform: rotate(360deg); } }
`;
document.head.appendChild(style);

// 開発用の最小限の画面切り替え: /hazard-map を開くと道路グラフ画面、
// それ以外は従来通りバス停/駅グラフ画面を表示する。
// 本格的なUI統合(タブ切り替え等)は別サブプロジェクトで決定する。
const RootComponent = window.location.pathname === '/hazard-map' ? RoadGraphView : App;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>
);
