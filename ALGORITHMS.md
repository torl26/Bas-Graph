# 計算の仕組み・アルゴリズム詳細

このドキュメントは、久留米バス停重要度グラフアプリで行われている計算・アルゴリズムを
実装ファイル単位で解説する。対象ファイル:

- `buildGraph.js` — グラフ構築、重要度スコア計算、レイアウト計算
- `removalSafety.js` — バス停の削除安全度判定
- `population_data/scripts/assign_population.js` — 町丁目人口のバス停への割り当て（前処理）
- `App.jsx` — 上記の計算結果をUIに反映する部分（ランキング・エリア概況の集計ロジック）

---

## 1. グラフの構築 (`buildGraphFromLocalData`)

`busData.json`（`{ stops: [{id, name, lat, lng, connectedStopIds, population, populationArea}] }`）
から [graphology](https://graphology.github.io/) の無向グラフ（`multi: false, type: 'undirected'`）を構築する。

### 1.1 ノード

各バス停を1ノードとして追加する。

| 属性 | 内容 |
|---|---|
| `label` | バス停名（無ければ `停留所 {id}`） |
| `lat` / `lon` | 緯度・経度（未確定なら `null`） |
| `hasCoords` | 座標が確定しているか |
| `x` / `y` | 描画用座標。`x = 経度`, `y = -緯度`（Sigma.jsは画面座標系がY軸下向きのため反転） |
| `population` | 町丁目人口（無ければ `null`） |

### 1.2 エッジ

2種類のソースからエッジを作る（既存エッジは `graph.hasEdge` で重複チェックして1本のみ）。

1. **`routes`（系統データ）**: 系統内の隣接する停留所同士を接続。系統ごとに
   `EDGE_PALETTE`（8色パレット）を `routeIndex % 8` で割り当てて色分け。
   現行の `busData.json` には `routes` が無いため後方互換用。
2. **`stops[].connectedStopIds`（個別接続）**: 現在の主データソース。
   全て同一色 `CONNECTION_EDGE_COLOR`（`#94a3b8` slate-400）でエッジを張る。

### 1.3 座標未確定ノードの位置推定（緩和法／離散ラプラス方程式）

`estimateMissingPositions(graph)`

一部のバス停は緯度経度が未調査（`lat/lng = null`）。これらの表示位置を、
**接続している隣接ノードの座標の単純平均に近づける反復法**で推定する。

1. 座標確定済みノード群の重心 `(centerX, centerY)` を計算。
2. 未確定ノードの初期位置は、重心を中心に**黄金角**（`2.399963` rad ≈ 137.5°）で
   角度をずらしながら少しずつ半径を変えて配置し、初期段階でのノード重なりを回避する。
   ```
   angle = i * 2.399963
   radius = 0.01 * (1 + (i % 5))
   x = centerX + radius * cos(angle)
   y = centerY + radius * sin(angle)
   ```
3. 60回反復。各反復で、未確定ノードそれぞれについて**隣接ノード（既知・未知どちらも含む）の
   座標の算術平均**を新しい座標として代入する。

   ```
   x_new(n) = mean(x(m) for m in neighbors(n))
   y_new(n) = mean(y(m) for m in neighbors(n))
   ```

   これは各未知ノードの値をその近傍の平均で置き換える**ヤコビ緩和法**であり、
   離散版ラプラス方程式 `Δf = 0`（調和関数）を満たす解に収束する。物理的には
   「ノード間をバネで繋いだときの静止位置」に相当する簡易バネモデル。
   既知座標ノードの位置は反復中一切動かさない（Dirichlet境界条件）。
4. 孤立ノード（隣接なし）は初期位置のまま。

この推定座標は `layout: 'geo'` モードでの表示位置、および `force` モードの
反復計算の初期値（シード）として使われる。

### 1.4 ForceAtlas2による力学的レイアウト（`layout: 'force'`）

`applyForceDirectedLayout(graph)`

実際の地理座標では接続線がジグザグに交差して見づらいため、
[graphology-layout-forceatlas2](https://graphology.github.io/standard-library/layout-forceatlas2)
を使い、**グラフ構造（接続関係）のみに基づいて**ノードを再配置する。

- `forceAtlas2.inferSettings(graph)` でノード数・エッジ数からパラメータを自動推定。
- `iterations: 1000` で反復計算。
- アルゴリズムの概要（Force Atlas 2、Jacomy et al.）:
  - ノード間に**反発力**（すべてのノード対に働く、次数に応じて調整）
  - エッジで結ばれたノード間に**引力**（バネのように接続先へ引き寄せる）
  - 上記の力の平衡点に向かって勾配降下的に座標を更新
  - 結果として、接続の強いノード同士が近くに集まり、疎な部分は広がる配置になる
- 実際の緯度経度 (`lat`/`lon`) は変更せず、表示用の `x`/`y` だけを上書きする。

---

## 2. 重要度スコアの計算 (`applyImportanceScores`)

グラフ構築後、各ノードに「重要度スコア」を付与する。3つの指標を正規化・加重平均する。

### 2.1 次数中心性 (Degree Centrality)

`graphology-metrics/centrality/degree` の `degreeCentrality(graph)` を使用。

```
degree_centrality(v) = deg(v) / (n - 1)
```

ノードの次数（接続本数）を、グラフの最大可能次数 `n-1`（`n`はノード数）で割った値。
「そのバス停に直接つながっている他バス停がどれだけ多いか」を表す。

### 2.2 媒介中心性 (Betweenness Centrality)

`graphology-metrics/centrality/betweenness` の `betweennessCentrality(graph, { normalized: true })` を使用。
内部実装は **Brandesのアルゴリズム**（`O(V×(V+E))`、全点対の最短経路を効率的に集約して計算）。

```
betweenness(v) = Σ_{s≠v≠t} ( σ_st(v) / σ_st )
```

- `σ_st` : ノード`s`から`t`への最短経路の総数
- `σ_st(v)` : そのうちノード`v`を経由するものの数

正規化版（`normalized: true`）はこれを `2 / ((n-1)(n-2))`（無向グラフの場合）で割り、
0〜1の範囲に収める。「多くの最短経路がこのバス停を経由している＝ネットワーク上の
ハブ・中継点としての重要性」を表す。計算に失敗した場合（非連結グラフでのエラー等）は
`try/catch`で捕捉し全ノード0にフォールバックする。

### 2.3 地域人口 (Population)

各ノードの `population` 属性（町丁目人口。後述の前処理スクリプトで割り当て済み）。
未割り当ての場合は `0` として扱う（＝重要度の観点では最下位）。

### 2.4 正規化 (Min-Max Normalization)

3指標それぞれについて、全ノードの値を `[0, 1]` にスケーリング。

```
normalize(v) = (v - min) / (max - min)   // max === min の場合は全て 0.5
```

### 2.5 加重平均

```
totalWeight = weights.degree + weights.betweenness + weights.population
```

- `totalWeight > 0` ならユーザー指定の重み（UIのスライダー、既定値 `{degree: 0.5, betweenness: 0.5, population: 0}`）をそのまま使用。
- 全て0（totalWeight === 0）の場合は3指標を均等（各 `1/3`）に使うフォールバック。

```
score(v) = ( w.degree × degreeNorm(v)
           + w.betweenness × betweennessNorm(v)
           + w.population × populationNorm(v) ) / denom
```

`denom` は `totalWeight`（0の場合は1）。重みの絶対値に関わらずスコアは常に0〜1の範囲になる。

### 2.6 スコアから見た目へのマッピング

- **サイズ**: `size = 2 + score * 10`（2px〜12pxの線形マッピング）
- **色**: 4色のグラデーションを線形補間する `scoreToColor(score)`

  | スコア閾値 | 色 | 意味 |
  |---|---|---|
  | 0 | `rgb(56,189,248)` sky-400 | 低重要度 |
  | 0.35 | `rgb(45,212,191)` teal-400 | |
  | 0.65 | `rgb(202,138,4)` amber-700 (olive) | |
  | 1 | `rgb(249,115,22)` orange-500 | 高重要度 |

  スコアが属する区間 `[t0, t1]` を見つけ、区間内の相対位置 `t = (score - t0) / (t1 - t0)` で
  RGB各チャンネルを線形補間する。

---

## 3. OSMデータからのグラフ構築 (`buildGraphFromOSM`)

Overpass APIの生データ（`stopElements`, `routeElements`）から直接グラフを作る代替パス
（現状 `App.jsx` からは未使用、`useOverpassBusStops.js` と組み合わせて使う想定）。

- ノード: `type === 'node'` の要素をバス停として追加。
- エッジ: `type === 'relation'`（バス路線）の `members` を順に走査し、
  バス停として認識済みのノードのみを抽出してルート順に隣接接続する。
  同一路線内で連続するバス停ペアごとにエッジを張り、`EDGE_PALETTE` で路線ごとに色分け。
- 孤立ノード（どの路線にも属さない停留所）は削除せずそのまま残す。重要度は自然に最低値になる。
- 重要度計算は `applyImportanceScores` を共通利用（人口重みは常に0扱い、`population`属性が無いため）。

---

## 4. バス停削除の安全度判定 (`removalSafety.js`)

あるバス停を削除した場合の影響度を、実際に削除してグラフを再計算する方式（`O(n^2 × (V+E))`、
数百ノード規模だとUIがフリーズしうる）ではなく、**削除前の1回のグラフ解析だけで済む
近似指標2つの組み合わせ**で判定する。

### 4.1 関節点判定 (Articulation Point) — Tarjanのアルゴリズム

`findArticulationPoints(graph)`

削除するとグラフが非連結になってしまうノード（＝そのバス停がネットワーク上の
唯一の橋渡し役）を検出する。**DFSの発見時刻(`disc`)とlow-link値(`low`)**を使う
古典的な Tarjan のアルゴリズム。計算量 `O(V+E)`。

- `disc[u]`: ノード`u`をDFSで訪れた順番（発見時刻）
- `low[u]`: `u`から「後退辺（back edge）」を1本だけ使って到達できる最も浅い（＝小さいdisc値の）ノードの発見時刻

DFS中の更新規則:
```
low[u] = min(low[u], disc[v])         // v が訪問済み（後退辺）の場合
low[u] = min(low[u], low[v])          // v が子ノードの場合（DFS木の子を辿った後）
```

関節点判定条件:
- **ルートノード**: DFS木で子が2つ以上ある場合、ルートは関節点。
  （ルートを消すと、異なる子から始まる部分木同士がつながらなくなるため）
- **非ルートノード `u`**: 子`v`について `low[v] >= disc[u]` が成り立つ場合、`u`は関節点。
  （`v`側の部分木が、`u`を経由せずに`u`より浅い祖先へ戻る後退辺を一切持たない＝
  `u`を消すとその部分木が孤立する）

再帰DFSで実装（バス停は高々数百件規模のため、再帰スタック深さの心配は無いという想定コメントあり）。

### 4.2 Vitality（媒介中心性ベースの近似指標）

`computeVitality(graph)`

本来の "vitality" は「ノードを取り除いた前後でのネットワーク効率性の変化量」だが、
実際に全ノードについて削除→再計算を行うのは高コストなため、代わりに
**1回のBrandesのアルゴリズムで計算できる正規化媒介中心性をそのままVitalityの近似値として使う**
（§2.2と同一のアルゴリズム・同一の値）。

> 直感: あるノードを経由する最短経路の割合が高いほど、そのノードを消したときに
> 多くの経路が迂回を強いられる＝ネットワークへの影響が大きい、とみなす。

失敗時は全ノード0にフォールバック。

### 4.3 Haversine公式（2点間の球面距離）

`haversineDistance(lat1, lon1, lat2, lon2)`

地球を半径 `R = 6,371,000 m` の球とみなし、2点間の大圏距離（最短距離）を計算する。

```
Δlat = toRad(lat2 - lat1)
Δlon = toRad(lon2 - lon1)
a = sin²(Δlat/2) + cos(lat1)·cos(lat2)·sin²(Δlon/2)
distance = 2R · asin(√a)
```

各バス停について、座標が確定している他の全バス停との距離を総当たりで計算し、
最短距離（最寄りの別バス停までの距離）を求める（`O(n)` per stop、全体 `O(n²)`）。

### 4.4 安全度レベルの判定ロジック

定数:
- `NEARBY_ALTERNATIVE_RADIUS_M = 400`（メートル。徒歩で代替可能とみなす閾値）
- `VITALITY_CAUTION_THRESHOLD = 0.02`（正規化媒介中心性2%以上で「注意」）

`assessRemovalSafety(graph, busData)` は各バス停について、以下を**優先順位付きで**判定する
（上から順にチェックし、最初に該当した条件を採用）:

| 順位 | 条件 | レベル | 理由 |
|---|---|---|---|
| 1 | 関節点である | `unsafe`（危険） | 削除するとネットワークが分断される |
| 2 | `vitality >= 0.02` | `caution`（注意） | 多くの経路がこのバス停を経由している |
| 3 | 座標未登録 | `caution`（注意） | 近隣バス停との重複を判定できない |
| 4 | 400m以内に他バス停が無い | `caution`（注意） | 徒歩圏に代替バス停が無い |
| — | 上記いずれにも該当しない | `safe`（安全） | 代替バス停があり、削除の影響は小さい |

出力: `{ level, reason, isArticulation, vitality, hasCoords, nearestAlternativeDistance }`
（バス停IDをキーとするオブジェクト）。

---

## 5. 町丁目人口のバス停への割り当て（前処理・`population_data/scripts/assign_population.js`）

`busData.json` の各バス停に、対応する町丁目（chome）の人口を付与する**オフライン前処理スクリプト**
（実行結果は `population_data/stop_population.json` に書き出され、`busData.json` に反映済みの想定）。

### 5.1 データソース

`population_data/chome_raw/{市区町村コード}/` 配下のシェープファイル（`.shp` + `.dbf`、
Shift-JISエンコード）を [`shapefile`](https://www.npmjs.com/package/shapefile) パッケージで読み込む。
各フィーチャの属性から以下を取得:

- `JINKO`: 人口（欠損・非数値は0扱い）
- `CITY_NAME` / `S_NAME`: 市区町村名・町丁目名
- `X_CODE` / `Y_CODE`: 町丁目の重心座標

### 5.2 点-in-多角形判定 (Point-in-Polygon) — レイキャスティング法

`pointInRing(x, y, ring)`

**交差数（crossing number）法**によるレイキャスティング判定。点から任意方向（ここでは
水平方向、+X方向）に無限半直線を伸ばし、多角形の辺との交差回数を数える。奇数回なら内部、
偶数回なら外部。

```js
for 各辺 (xi,yi)-(xj,yj):
  if (yi > y) !== (yj > y):              // 辺がyの高さをまたいでいるか
    if x < 辺とy=yの交点のx座標:
      inside = !inside                     // 交差ごとにトグル
```

`Polygon` はコーディネート配列の最初のリング（外周。穴は無視）、`MultiPolygon` は
構成する各ポリゴンについて判定し、いずれか1つでも内部ならヒットとする
（`pointInPolygonGeom`）。

### 5.3 割り当てロジック

各バス停 `(lat, lng)` について:

1. 全町丁目ポリゴンを走査し、点を含む（`pointInPolygonGeom` が真になる）最初の町丁目を採用
   （`method: 'contains'`）。
2. 該当する町丁目が見つからない場合（境界データの隙間・誤差などで漏れる場合）は、
   **最も近い重心を持つ町丁目**にフォールバック（`method: 'nearest_centroid'`、
   ユークリッド距離の2乗 `dx² + dy²` で比較、平方根は省略して高速化）。
3. 座標未確定のバス停（`lat`/`lng` が数値でない）はスキップ（`missingCoords` としてカウント）。

結果は `{ [stopId]: { name, cityName, areaName, population, method } }` の形で
`stop_population.json` に書き出される。この人口値が `busData.json` の各stopの
`population` / `populationArea` として使われ、§2.3の重要度計算の入力になる。

---

## 6. UI側の集計ロジック (`App.jsx`)

グラフ計算結果を画面表示用に整形する部分（複雑なアルゴリズムは無いが計算式として記載）。

### 6.1 重要度ランキング

全ノードを `score = round(importance * 100)` で降順ソート。

### 6.2 危険度ランキング

`removalSafety` の結果を用い、以下の複合ソートキーで並べる:

```
sort by: SAFETY_LEVEL_ORDER[level] desc, vitality desc
// SAFETY_LEVEL_ORDER = { unsafe: 2, caution: 1, safe: 0 }
```

危険 → 注意 → 安全の順、同レベル内はVitality（媒介中心性）が高い順。

### 6.3 エリア概況

- `avg`: 全ノードスコアの単純平均
- `high`: スコア70以上のノード数
- `unsafe`: `removalSafety` で `level === 'unsafe'`（関節点）のノード数

### 6.4 重み変更時の再計算

`weights` または `layoutMode` が変化するたびに `buildGraphFromLocalData` を
`busData.json` から丸ごと再実行する（`useEffect` の依存配列に `[weights, loaded, layoutMode]`）。
差分更新ではなく、グラフ構築・中心性計算・レイアウト計算を毎回フルで再実行する設計。

---

## 7. 全体の計算量まとめ

`n` = バス停数、`m` = 接続（エッジ）数として:

| 処理 | 計算量 | 備考 |
|---|---|---|
| 次数中心性 | `O(n + m)` | |
| 媒介中心性（Brandes） | `O(n × (n + m))` | 重要度計算とVitality計算で共通利用 |
| 座標未確定ノードの位置推定 | `O(60 × n)` | 反復回数固定 |
| ForceAtlas2レイアウト | `O(1000 × n²)` 程度 | 反復ごとに全ノード対の反発力を計算（力の近似最適化により実際はBarnes-Hut等で高速化される場合あり） |
| 関節点判定（Tarjan） | `O(n + m)` | |
| 最寄り代替バス停探索 | `O(n²)` | バス停ごとに全バス停と距離比較 |
| 町丁目人口の点-in-多角形判定（前処理） | `O(n × 町丁目数)` | 一度きりのオフライン処理 |

バス停数が数百件規模であることを前提に、いずれも実用上問題ない速度で動作する設計になっている
（コード中のコメントにもその設計意図が明記されている）。
