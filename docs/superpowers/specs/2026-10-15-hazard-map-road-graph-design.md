# ハザードマップ: 道路網グラフ化＆グラフ理論転用 設計書

## 背景・目的

`Bas-Graph`はこれまでバス停・駅のネットワークをグラフとして可視化し、グラフ理論（次数中心性・媒介中心性・Tarjanの関節点検出・Vitality指標）で重要度と削除時の危険度を分析してきた。

今後、このプロジェクトを土台に「リアルタイムハザードマップ」機能（避難所情報・道路状況・河川状況を加味した現在地の危険度判定・避難所までのルート案内）を追加していく計画がある。この機能は、データ取得・危険度判定・ルート計算という複数のサブシステムに分かれる大きめの仕事になるため、全体を一度に設計せず、サブプロジェクト単位で順に設計・実装する。

本スペックは、その最初のサブプロジェクト **「久留米市の道路網をグラフ化し、既存のグラフ理論ロジック（中心性・関節点・Vitality）を適用して可視化する」** を対象にする。河川・避難所データとの統合、実際の危険度判定、ルート計算は次回以降のサブプロジェクトで設計する。

## スコープ

**対象:**
- 久留米市内の道路網（OpenStreetMap由来）を、交差点をノード・道路区間をエッジとするグラフデータに変換する一回限りの前処理パイプライン
- 既存の`buildGraph.js`・`removalSafety.js`（中心性計算・ForceAtlas2レイアウト・関節点検出・Vitality判定）を、データセットに依存しない共通ロジックとして`src/shared/graphAnalysis/`に移動し、バス停/駅グラフと道路グラフの両方から利用できるようにする
- 道路網を可視化する新規UI（地図モード、重要度の色分け、危険度ランキング）を`src/features/hazard-map/`に追加する
- 開発中に道路グラフ画面へアクセスするための最小限の入り口（本格的なUI統合は別サブプロジェクトで決定）

**対象外（やらないこと）:**
- 河川・避難所データの取得・統合
- 現在地の危険度判定ロジック（河川氾濫や通行止めを考慮したもの）
- 避難所までのルート計算
- 既存グラフ画面（バス停/駅）とハザードマップ機能のUI上の本格的な連携方法の決定（未定のまま）
- `busData.json`・`stationData.json`・既存の`App.jsx`の挙動変更

## アーキテクチャ・ファイル構成

```
src/shared/graphAnalysis/
  buildGraph.js            # src/features/bus-graph/から移動。中身は無変更（汎用ロジックのため）
  buildGraph.test.js
  removalSafety.js
  removalSafety.test.js

src/data/road_data/
  scripts/
    fetch_roads.js         # Overpass APIから久留米市内のhighway=*wayを取得、生OSM JSONを保存
    build_road_graph.js    # 生OSM JSON → { stops: [...] } 形式に変換するロジック＋CLI実行部
  osm_roads_raw.json         # fetch_roads.jsの出力（生データ）

src/data/
  roadData.json              # build_road_graph.jsの出力（最終的なグラフ用データ）

src/features/hazard-map/
  RoadGraphView.jsx         # 道路グラフの可視化（地図モード、重要度の色分け、危険度ランキング）
  README.md                  # 既存プレースホルダーを更新（本スペックへのリンクを追加）
```

### 各ファイルの役割

- `src/shared/graphAnalysis/buildGraph.js` / `removalSafety.js` — データセットに依存しない汎用ロジック。`{ stops: [{id, name, lat, lng, connectedStopIds}] }`形状のデータを受け取り、グラフ構築・重要度スコア計算・関節点検出・Vitality判定を行う。バス停・駅・道路網のいずれでも同じ関数を使う。
- `src/data/road_data/scripts/fetch_roads.js` — Overpass APIへの問い合わせのみを担当。`useOverpassBusStops.js`と同じ久留米市境界ID（area id = 3600000000 + relation 4008314）のクエリパターンを再利用する。
- `src/data/road_data/scripts/build_road_graph.js` — OSMのway（道路の形状点列）から交差点を抽出し、`{ stops: [...] }`形式に変換する。変換ロジックは`osmWaysToRoadGraph(elements)`という純粋関数としてエクスポートし、単体テスト可能にする。
- `src/features/hazard-map/RoadGraphView.jsx` — `roadData.json`を読み込み、`src/shared/graphAnalysis/`の関数で重要度・危険度を計算し、地図モードで表示する。既存`App.jsx`の地図モード表示部分を参考に新規で書く（`App.jsx`自体は759行あり、データセット切り替えなど道路網には不要な要素が多いため、共有コンポーネント抽出はせず今回は複製にとどめる）。

## データフロー・変換ロジック

```
fetch_roads.js
  → Overpass APIクエリ（area(3600000000+4008314)内の
    highway=motorway|trunk|primary|secondary|tertiary|unclassified|residential のway）
  → src/data/road_data/osm_roads_raw.json に保存（{version, elements: [...]} ways+nodes）

build_road_graph.js
  → osm_roads_raw.json を読み込み
  → osmWaysToRoadGraph(elements) で変換:
      1. 各wayのnode参照を走査し、「2つ以上のwayに現れるノード」または
         「wayの端点（最初/最後のノード）」を交差点として抽出する
      2. 交差点間を結ぶ区間ごとに、区間内の全座標点をHaversine距離で
         積算し、エッジ長（メートル）を算出する
      3. { stops: [{id, name: null, lat, lng, connectedStopIds: [...]}] }
         形式で出力する
  → src/data/roadData.json に書き出す
```

対象道路種別は車両が使う主要な道路網（`motorway, trunk, primary, secondary, tertiary, unclassified, residential`）に絞る。歩道・自転車道・サービス道路は除外する（避難時の徒歩ルートなど別種別が必要になれば、ルート計算を扱う次のサブサイクルで検討する）。

`roadData.json`が`busData.json`と同じ`{ stops: [...] }`形状であるため、`buildGraphFromLocalData()`・`assessRemovalSafety()`は無変更で流用できる。

## UI・エントリーポイント

既存の`App.jsx`には「どちらの機能を表示するか」を切り替える仕組みがないため、開発中に道路グラフ画面へアクセスできるよう最小限の分岐を追加する。

- `src/main.jsx`で`window.location.pathname`を見て、`/hazard-map`なら`<RoadGraphView />`、それ以外（既定）なら従来通り`<App />`（bus-graph、`src/features/bus-graph/App.jsx`）をレンダリングする
- react-routerなどのルーティングライブラリは導入しない（2画面の単純な出し分けにはオーバースペック、YAGNI）
- 正式なUI統合（タブ切り替えなど）は引き続き未定。ここでは最終形を決め打ちせず、後から置き換え可能な最小限の作りにする

## テスト

- `osmWaysToRoadGraph()`は純粋関数として`build_road_graph.test.js`で単体テストする。合成的な小さいOSM要素データ（交差点2つを結ぶ単純な道、T字路、独立したway等）を使い、交差点抽出とエッジ距離計算を検証する
- `fetch_roads.js`自体（ネットワーク呼び出し）はテスト対象外とする（`population_data/scripts/`と同様、手動実行前提のスクリプトのため）
- `buildGraph.js`/`removalSafety.js`の移動後、既存テスト（15件）が`src/shared/graphAnalysis/`から引き続き通ることを確認する
- `RoadGraphView.jsx`は手動ブラウザ確認（`npm run dev`で`/hazard-map`を開き、描画・重要度の色分け・危険度ランキングを目視確認する）

## リスク・注意点

- `removalSafety.js`の「近隣に代替拠点があるか」判定（半径400m以内）はバス停間隔を想定したヒューリスティックであり、交差点の密度が高い道路網にそのまま適用すると、ほとんどの交差点が「安全」判定になりやすい。今回は可視化のみが目的のため許容するが、実際の危険度判定ロジックを設計する次のサブサイクルで見直しが必要になる可能性がある。
- OSMの道路データはノード数・エッジ数がバス停データ（344件）より大幅に多くなる可能性がある（久留米市内の全主要道路）。ForceAtlas2のレイアウト計算やTarjanの関節点検出（再帰DFS）のパフォーマンスに影響する場合は、対象道路種別をさらに絞る調整が必要になる可能性がある。
- `src/shared/graphAnalysis/`への移動は`src/features/bus-graph/App.jsx`のimportパス変更を伴う（`./buildGraph.js` → `../../shared/graphAnalysis/buildGraph.js`等）。既存の挙動を変えないことを確認する。
