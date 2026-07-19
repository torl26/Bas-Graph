import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

// スピナーアニメーション
const style = document.createElement('style');
style.textContent = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { overflow: hidden; }
  @keyframes spin { to { transform: rotate(360deg); } }
`;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
