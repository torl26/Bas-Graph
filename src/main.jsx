import React from 'react';
import ReactDOM from 'react-dom/client';

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
// どちらの画面もそれぞれ数MBのデータ(busData.json/stationData.json、
// roadData.json)を静的importしているため、動的importで実際に表示する
// 方だけを読み込む(静的importのままだと、バス停画面を開いただけで
// 使わない道路データ(約3MB)まで毎回ダウンロードしてしまう)。
const modulePromise = window.location.pathname === '/hazard-map'
  ? import('./features/hazard-map/RoadGraphView.jsx')
  : import('./features/bus-graph/App.jsx');

modulePromise.then(({ default: RootComponent }) => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <RootComponent />
    </React.StrictMode>
  );
});
