# バス停・駅 重要度グラフ

久留米市のバス停ネットワーク、およびJR九州・福岡市地下鉄・西鉄の駅ネットワークをグラフとして可視化し、
各拠点（バス停/駅）の「重要度」と「削除した場合の安全度」を分析するReactアプリケーション。
画面左上の「データセット」切り替えで、バス停データと駅データを切り替えて表示できる。

## できること

- **2種類のデータセットを切り替え可能**
  - バス停（久留米市）: `busData.json`
  - 駅（JR九州・福岡市地下鉄・西鉄）: `stationData.json`（九州全県のJR九州の駅 + 福岡市地下鉄空港線・箱崎線・七隈線 + 西鉄天神大牟田線・太宰府線・甘木線・貝塚線、計408駅）
- **グラフ可視化**（[sigma.js](https://www.sigmajs.org/) / [react-sigma](https://sigma-js.github.io/react-sigma/)）
  - 地図モード: 実際の緯度経度で拠点を配置
  - ネットワークモード: [ForceAtlas2](https://graphology.github.io/standard-library/layout-forceatlas2)による力学的レイアウトで接続関係を再配置し、線の交差を減らして表示
- **重要度スコアの計算・調整**
  - 次数中心性・媒介中心性・人口指標（バス停は地域人口(町丁目)、駅は1日平均乗車人員/乗降人員）の3指標を重み付けして合成
  - UIのスライダーでリアルタイムに重みを変更可能
  - スコアに応じてノードのサイズと色（水色→オレンジのグラデーション）が変化
- **拠点削除の安全度判定**
  - 関節点（削除するとネットワークが分断される拠点）をTarjanのアルゴリズムで検出
  - 媒介中心性ベースのVitality指標、および近隣の代替拠点の有無から「安全 / 注意 / 危険」を判定
- **エリア・ランキング表示**: 重要度ランキングやエリア別の概況集計をUIに表示
- **データ出典・注意事項の表示**: 左パネル下部の折りたたみセクションで、データセットごとの出典・作成方針・注意点（`sourceNote`）を確認できる。駅データでは西鉄側が「乗降人員」、JR九州・福岡市地下鉄側が「乗車人員」で単位が異なる点に特に注意（駅詳細パネルでも路線に応じてラベルを出し分けている）。

計算・アルゴリズムの詳細は [ALGORITHMS.md](./ALGORITHMS.md) を参照（バス停データを例に解説しているが、`buildGraphFromLocalData` 以下の計算ロジックは駅データにも共通で適用される）。

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
App.jsx                 メイン画面・UI（データセット切り替え、重みパネル、ランキング、凡例、出典表示など）
main.jsx                エントリーポイント
buildGraph.js           グラフ構築・重要度スコア計算・レイアウト計算（バス停・駅データ共通）
removalSafety.js        削除安全度判定（関節点・Vitality・最寄り代替拠点、バス停・駅データ共通）
useOverpassBusStops.js  Overpass APIからのバス停・路線データ取得（久留米市境界で絞り込み）。
                        現状App.jsxからは未使用で、buildGraph.jsのbuildGraphFromOSMと組み合わせて
                        使う、将来のライブ取得モード用の代替パス（詳細はALGORITHMS.md §3）。
busData.json            バス停データ本体（座標・接続関係・地域人口を含む）
stationData.json        駅データ本体（JR九州・福岡市地下鉄・西鉄の座標・接続関係・乗車/乗降人員・出典注記(sourceNote)を含む）
osm_kurume.json / osm_bbox.json  OSM由来の補助データ
population_data/        町丁目人口データとバス停への割り当て前処理スクリプト
ALGORITHMS.md           アルゴリズム・計算ロジックの詳細解説
```

## データソース

- バス停・道路データ: [OpenStreetMap](https://www.openstreetmap.org/)（Overpass API）
- 町丁目人口データ: `population_data/chome_raw/` 配下のシェープファイルを前処理し、各バス停に最寄りの町丁目人口を割り当て（詳細は ALGORITHMS.md §5）
- 駅・乗車/乗降人員データ: JR九州公式サイト、福岡市オープンデータカタログ（福岡市地下鉄）、国土交通省「国土数値情報」経由の集計値（西鉄）。詳細な出典URL・単位の違い等の注意事項は `stationData.json` の `sourceNote`、またはアプリ左パネルの「データ出典・注意事項」を参照。
