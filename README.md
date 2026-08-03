# 久留米バス停重要度グラフ

久留米市のバス停ネットワークをグラフとして可視化し、各バス停の「重要度」と「削除した場合の安全度」を分析するReactアプリケーション。

## できること

- **グラフ可視化**（[sigma.js](https://www.sigmajs.org/) / [react-sigma](https://sigma-js.github.io/react-sigma/)）
  - 地図モード: 実際の緯度経度でバス停を配置
  - ネットワークモード: [ForceAtlas2](https://graphology.github.io/standard-library/layout-forceatlas2)による力学的レイアウトで接続関係を再配置し、線の交差を減らして表示
- **重要度スコアの計算・調整**
  - 次数中心性・媒介中心性・地域人口（町丁目人口）の3指標を重み付けして合成
  - UIのスライダーでリアルタイムに重みを変更可能
  - スコアに応じてノードのサイズと色（水色→オレンジのグラデーション）が変化
- **バス停削除の安全度判定**
  - 関節点（削除するとネットワークが分断されるバス停）をTarjanのアルゴリズムで検出
  - 媒介中心性ベースのVitality指標、および徒歩圏内の代替バス停の有無から「安全 / 注意 / 危険」を判定
- **エリア・ランキング表示**: 重要度ランキングやエリア別の概況集計をUIに表示

計算・アルゴリズムの詳細は [ALGORITHMS.md](./ALGORITHMS.md) を参照。

## 技術スタック

- [React](https://react.dev/) 18 + [Vite](https://vitejs.dev/)
- [graphology](https://graphology.github.io/)（グラフ構造） + `graphology-metrics` / `graphology-layout-forceatlas2`
- [sigma.js](https://www.sigmajs.org/) / `@react-sigma/core`（グラフ描画）

## セットアップ

```bash
npm install
npm run dev
```

ブラウザで表示されたURL（既定では `http://localhost:5173`）を開く。

### ビルド

```bash
npm run build
```

## プロジェクト構成

```
App.jsx                 メイン画面・UI（重みパネル、ランキング、凡例など）
main.jsx                エントリーポイント
buildGraph.js           グラフ構築・重要度スコア計算・レイアウト計算
removalSafety.js        バス停削除の安全度判定（関節点・Vitality・最寄り代替バス停）
useOverpassBusStops.js  Overpass APIからのバス停・路線データ取得（久留米市境界で絞り込み）
busData.json            バス停データ本体（座標・接続関係・人口を含む）
osm_kurume.json / osm_bbox.json  OSM由来の補助データ
population_data/        町丁目人口データとバス停への割り当て前処理スクリプト
ALGORITHMS.md           アルゴリズム・計算ロジックの詳細解説
```

## データソース

- バス停・道路データ: [OpenStreetMap](https://www.openstreetmap.org/)（Overpass API）
- 町丁目人口データ: `population_data/chome_raw/` 配下のシェープファイルを前処理し、各バス停に最寄りの町丁目人口を割り当て（詳細は ALGORITHMS.md §5）
