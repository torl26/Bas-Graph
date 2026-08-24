# PDCA Plan — bus-graph 改善タスク

このファイルはPDCAサイクルの Plan（何を直すか）を管理する台帳。
各サイクルはこのファイルの Backlog から1件選び、Plan → Do → Check → Act の順で処理する。

## 運用ルール

- **Plan**: Backlog から未着手(`todo`)のタスクを1件選ぶ。優先度は上から順。
- **Do**: `fix/<slug>` ブランチを作成し、該当タスクのみを最小差分で実装する。
- **Check**: `npm run build` が通ることを確認する。UIに関わる変更は可能なら `npm run dev` を起動し目視確認する。
- **Act**:
  - 問題なければ push し、`gh pr create` でPRを作成。PR番号をこのファイルの該当行に記録し、statusを `pr_open` にする。
  - 作業中に新しい「まだやっていないこと」を見つけたら Backlog に追記する（自己完結で直せる粒度に分割する）。
  - 1サイクル1タスクを厳守し、無関係な変更を混ぜない。

## Backlog

| status | id | 内容 | 備考 |
|---|---|---|---|
| todo | sourcenote-bus | `busData.json` に `sourceNote` が無く、バス停データセット選択時に左パネルの「データ出典・注意事項」欄が表示されない | `stationData.json` の `sourceNote` を参考に、バス停データの出典（OpenStreetMap Overpass API、町丁目人口データ等）をまとめて追加する |
| todo | station-label-bus-text | 駅データセットを選択していても、凡例の「バス停の接続」（App.jsx:182）とノード詳細の「最寄り代替バス停」（App.jsx:293）がバス停表記のまま固定 | `AreaStats` の `itemLabel`（App.jsx:550）と同様に `datasetKey` で出し分ける |
| todo | dead-code-overpass | `useOverpassBusStops.js`（Overpass APIからのライブ取得フック）がどこからもimportされていない未使用コード | 静的JSON方式に切り替わった後の残骸。削除するか、READMEに「未使用・将来のライブ取得用」と明記するかを判断して対応 |
| todo | no-tests | `package.json` にtestスクリプトが無く、テストが一切存在しない。`buildGraph.js`（重要度スコア計算）・`removalSafety.js`（関節点・Vitality判定）はロジックが複雑な割に無検証 | vitest等の軽量テストランナーを導入し、`buildGraphFromLocalData` と `assessRemovalSafety` に対する最小限のユニットテストを追加する |

## Done

(まだなし)
