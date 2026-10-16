# ディレクトリ構成変更 設計書

## 背景・目的

現行の `Bas-Graph` は「バス停・駅 重要度グラフ」アプリで、`App.jsx` / `buildGraph.js` /
`removalSafety.js` などのソースと、`busData.json` / `stationData.json` /
`population_data/` などのデータファイルがすべてリポジトリのルート直下に
フラットに置かれている。

今後、このプロジェクトを土台にして「リアルタイムハザードマップ」機能
（避難所情報・道路状況・河川状況を加味した現在地の危険度判定・避難所までの
ルート案内）を追加していく計画がある。この機能追加は、データ取得・危険度判定・
ルート計算という複数のサブシステムに分かれる大きめの仕事になるため、
ハザードマップ自体の設計は別サイクルで行う。

本スペックはその前段として、**既存コードを壊さずに、今後の機能追加を
受け入れやすいディレクトリ構成に移行すること**だけを対象にする。

## スコープ

**対象:**
- ソースファイル・データファイルの `src/` 配下への移動
- 機能（feature）単位でのディレクトリ分離（`bus-graph` と、将来の `hazard-map` 用の
  プレースホルダー）
- データファイルの `src/data/` への集約
- 移動に伴う import パス / `index.html` のエントリパスの修正
- 移動後に `npm run build` と `npm test` が通ることの確認

**対象外（やらないこと）:**
- `App.jsx`（759行）の内部分割・リファクタリング
- ハザードマップ機能そのものの実装（データ取得・危険度判定・ルート計算・UI）
- 既存グラフ画面とハザードマップ機能のUI上の連携方法の決定（未定のため今回は何も
  前提を置かない）
- `docs/`, `README.md`, `ALGORITHMS.md`, `PDCA_PLAN.md` の内容変更（配置も現状維持）

## 新しいディレクトリ構成

```
src/
  main.jsx
  features/
    bus-graph/
      App.jsx                 # 現行のApp.jsxをそのまま移動（内部ロジックは変更しない）
      buildGraph.js
      buildGraph.test.js
      removalSafety.js
      removalSafety.test.js
      useOverpassBusStops.js
    hazard-map/
      README.md               # 空のプレースホルダー。今後の機能はここに実装する旨を記載
  data/
    busData.json
    stationData.json
    osm_bbox.json
    osm_kurume.json
    population_data/          # scripts/ 含め丸ごと移動

index.html                    # script src を /main.jsx → /src/main.jsx に変更
vite.config.js                # ルートのまま（必要なら resolve alias などは追加しない。YAGNI）
package.json                  # ルートのまま
README.md / ALGORITHMS.md / PDCA_PLAN.md  # ルートのまま、内容も変更なし
docs/                          # 変更なし
```

### 各ディレクトリの役割

- `src/features/bus-graph/` — 既存のバス停・駅グラフ機能一式。現状の振る舞いを
  そのまま保持する。
- `src/features/hazard-map/` — 将来のハザードマップ機能のための空のディレクトリ。
  今回は `README.md` に「ここに実装する」旨だけ書いておく（コードは置かない）。
- `src/data/` — JSON静的データおよびデータ生成スクリプト（`population_data/scripts/`）の
  集約場所。将来、河川・避難所データなどもここに追加していく想定。

## データフロー・import パスの変更

- `src/features/bus-graph/App.jsx` 内の以下のimportを変更:
  - `./busData.json` → `../../data/busData.json`
  - `./stationData.json` → `../../data/stationData.json`
  - `./buildGraph.js` / `./removalSafety.js` は同一ディレクトリ内のため変更不要
- `src/main.jsx` の `App` import 先を `./features/bus-graph/App.jsx` に変更
- `index.html` の `<script type="module" src="/main.jsx">` を
  `<script type="module" src="/src/main.jsx">` に変更
- `buildGraph.test.js` / `removalSafety.test.js` は同一ディレクトリ内の対象ファイルを
  importしているため、パス変更は不要（ディレクトリが一緒に移動するため）
- `population_data/scripts/*.js` がルート相対で `../busData.json` 等を参照していないか
  確認し、参照があれば移動後のパスに合わせて修正する

## テスト・確認方法

- 移動後、`npm run build` がエラーなく完了することを確認
- `npm test`（vitest）が全件パスすることを確認
- `npm run dev` を起動し、ブラウザで現行のバス停/駅グラフ表示が今まで通り動作することを
  目視確認（データセット切り替え・重要度スライダー・拠点削除の安全度判定など主要機能）

## リスク・注意点

- Vite はデフォルトで `index.html` を起点に依存解決するため、`index.html` の
  script パス修正を忘れると画面が真っ白になる。最初に確認するポイントとする。
- `population_data/scripts/assign_population.js` と `reverse_geocode.js` は
  `__dirname` からの相対パス（`DATA_DIR/../busData.json` など）で `busData.json` を
  参照している。`population_data/` と `busData.json` が両方 `src/data/` 配下に
  一緒に移動するため、相対関係は変わらず**このパスの修正は不要**（確認済み）。
