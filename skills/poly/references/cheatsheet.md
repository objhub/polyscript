# PolyScript チートシート

> GENERATED from docs/content/ja/cheatsheet.md -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

印刷して手元に置くとはかどる。たぶん。

---

## プリミティブ

### 3D

| 関数 | 引数 | 例 |
|---|---|---|
| `box` | w h d | `box 80 60 10` |
| `cylinder` | r h | `cylinder 5 10` |
| `sphere` | r | `sphere 10` |
| `cone` | r1 r2 h | `cone 10 0 20` |
| `torus` | r1 r2 | `torus 20 5` |
| `wedge` | dx dy dz ltx | `wedge 20 10 15 5` |
| `thread` | r pitch h | `thread 8 2 30 chamfer:true`（おねじ。`land:` `depth:` `chamfer:`） |

> **位置規約**: `box`/`cylinder`/`sphere`/`cone`/`torus`/`thread` は原点中心（centered）。`extrude h` は z=0..h で底面合わせ。混在する場合は `| floor` / `translate` / `center:(true,true,false)` で揃える。

### 2D

| 関数 | 引数 | 例 |
|---|---|---|
| `rect` | w h | `rect 50 30` |
| `circle` | r | `circle 10` |
| `ellipse` | rx ry | `ellipse 10 5` |
| `polygon` | n r | `polygon 6 10` |
| `polyline` | points | `polyline [(0,0), (10,0), (5,10)]` |
| `text` | content size | `text "ABC" 10` |
| `sketch` | [segments] | `sketch [(5,0), arc (5,0) (0,-5) (-5,0), (0,7), (5,0)]` |

`sketch` セグメント: タプル=直線, `arc 開始点 通過点 終点`=3点円弧, `arc 開始点 終点 center:(cx,cy)`=中心アーク, `arc 開始点 終点 radius:半径`=半径アーク, `bezier [制御点]`=ベジエ（開始点は前セグメント終端、制御点と末尾の終点のみ指定）, `spline [通過点]`=スプライン（同様）。最初の要素が開始点、自動close。

### パス

| 関数 | 引数 | 例 |
|---|---|---|
| `line` | start end | `line (0,0,0) (10,0,10)` |
| `arc` | start through end / start end center:(cx,cy) / start end radius:radius | `arc (0,0,0) (5,5,0) (10,0,0)`, `arc (0,0) (0,$r) center:(0,0)`, `arc (0,0) (5,3) radius:2` |
| `bezier` | points | `bezier [(0,0,0), (5,10,0), (10,0,0)]` |
| `helix` | pitch h r | `helix 5 30 10` |
| `spline` | points | `spline [(0,0,0), (10,5,5), (20,0,10)]` |
| `wire` | [segments] | `wire [(0,0), (10,0), arc (10,0) (15,5) radius:5]` |

`wire` は `sketch` のopen版（auto-closeなし）。複数セグメントを結合した開wireを作る。2D/3D両対応。sweepのspine(上流)に最適。型は **Wire**(曲線)で、閉じても面にはならない: `extrude`/`cut`/2Dブーリアンは不可、`offset d` で幅 `2|d|` の面(Face)にできる。`sketch` や `rect` など他の2Dプリミティブは **Face**(面):

```
wire [(0,0), (10,0), arc (10,0) (15,5) radius:5] | sweep (circle 5)
```

`sketch`と同様に、`workplane`と組み合わせて任意の平面上にパスを描ける:

```
workplane XZ | wire [(0,0),(10,0),(10,10),(0,10),(0,0)] | sweep (circle 2)
```

---

## パイプ操作

### 修飾

| 操作 | 説明 | 例 |
|---|---|---|
| `fillet r` | 角丸 | `fillet 2` |
| `chamfer r` | 面取り | `chamfer 1` |
| `shell t` | 中空化 | `faces >Z \| shell 2` |
| `offset d` | Face: 外形を相似に拡縮（+外側, -内側。穴のある面は不可）。Wire: 太さ `2\|d\|` の帯（開）/リング（閉）にして **Face** にする | `rect 80 60 \| offset -10` |
| `offset d cap:"square"` | 開いたワイヤーの端を丸めず垂直に切る（既定 `"round"`） | `wire [(0,0),(40,0),(40,30)] \| offset 2 cap:"square"` |
| `offset d join:"miter"` | 角を円弧でなく尖らせる（既定 `"round"`、他に `"tangent"`） | `offset 2 join:"miter"` |

> **直線1本（2点）の `wire` は `offset` できない。** `offsetWire2D: operation failed` になる。
> 中間点を足して2セグメントにすれば通る: `wire [(0,0),(20,0),(40,0)]`。

### ブーリアン

| 操作 | 説明 | 例 |
|---|---|---|
| `diff shape` | 引く | `diff cylinder 5 10` |
| `union shape` | 足す | `union sphere 5` |
| `inter shape` | 交差 | `inter box 20 20 20` |

パイプ操作: `box 10 10 10 | diff (sphere 7)`
ソースコマンド: `union [box 10 10 10, sphere 7]` / `diff [...]` / `inter [...]`
形状演算子: `a + b`（union）/ `a - b`（diff）/ `a * b`（inter）。**変数か括弧の間だけ**: `(box 10 10 10) - (cylinder 3 20)` は可、`box 10 10 10 - cylinder 3 20` はパースエラー（引数の算術と衝突）。`base - holes | fillet 2` は `(base - holes) | fillet 2`。`*` を `+`/`-` と混ぜるときは括弧を書く。長い式は演算子の前後で改行できる(行頭の `-` は後ろに空白: `- $b`)

### 配置

| 操作 | 説明 | 例 |
|---|---|---|
| `place shape` | 2D形状を配置 | `place $profile`, `place (circle 3)` |

変数に格納した2D形状を面の上に配置してから `cut` や `extrude` できる:

```
$s = sketch [(5,0), arc (5,0) (0,-5) (-5,0), (0,7), (5,0)]
box 10 10 10 | faces >Z | place $s | cut
```

### 2D → 3D

| 操作 | 説明 | 例 |
|---|---|---|
| `extrude h` | 押し出し | `extrude 10 draft:5` |
| `revolve axis [deg]` | 回転体（axis: X/Y/Z、deg省略で360°） | `revolve Y`, `revolve X 180` |
| `sweep profile` | 上流のwire(spine)に沿って profile を掃引。spine/profileはどちらもwireで、開/閉どちらでもよい | `helix 5 30 10 \| sweep (circle 2)` |
| `loft [sections] h` | 複数断面を接続 | `loft [rect 8 8] 10` |

### 加工

| 操作 | 説明 | 例 |
|---|---|---|
| `cut` | カット（省略で貫通） | `circle 5 | cut 3` |
| `hole r` | 穴あけ（面の中心 or 各ポイント、省略で貫通） | `faces top | hole 5` |

### 変形

| 操作 | 説明 | 例 |
|---|---|---|
| `floor` | 底面をz=0に揃える | `box 10 10 10 \| floor` |
| `translate x y z` | 平行移動(ソリッドと点・頂点の選択。2D 形状には使えない) | `translate 0 0 5` |
| `rotate rx ry rz` | ソリッドの回転(ワールド X・Y・Z 軸まわり、**3個ちょうど**) | `rotate 0 0 45` |
| `rotate a` | 2D 形状(Face / Wire)の面内回転(ワークプレーン法線まわり、**1個ちょうど**)。面から立てることはできない | `rect 10 10 \| rotate 45 \| extrude 5` |
| `scale s` / `scale sx sy sz` | スケール（一様/非一様） | `scale 2`, `scale 2 1 0.5` |
| `mirror "axis"` | 鏡像反転 | `mirror "X"` |
| `move dx dy` | 次に描く位置(カーソル)の相対移動。描いた形は動かない | `move 10 10 \| circle 5 \| cut` |
| `moveto x y` | 次に描く位置(カーソル)の絶対移動 | `moveto 30 20 \| rect 5 5 \| cut` |
| `color name` | 色指定 | `color "red"`, `color 0.8 0.2 0.1` |

`translate`, `rotate`, `scale` は `origin:` キーワードを受け付けます: `"world"`（デフォルト）, `"local"`（BBox中心）, `(x,y,z)`。

```
rotate 0 0 45 origin:"local"    # オブジェクト中心で回転
scale 2 origin:(10, 0, 0)       # 任意の点を基準にスケール
```

2D 形状は描いたワークプレーンから出られない。縦の面(XZ / YZ)にパスや輪郭を置くときは、
`rotate` で立てるのではなく最初からその面で描くか、3D 座標で書く:

```
workplane XZ | wire [arc (0,-25) (25,0) center:(0,0)] | sweep (circle 5)   # XZ 面の円弧パス
arc (0,0,-25) (25,0,0) center:(0,0,0) | sweep (circle 5)                  # 同じパスを 3D 座標で
```

---

## 選択とワークプレーン

### 選択

```
| faces sel        # 面を選択
| edges sel        # エッジを選択
| verts sel        # 頂点を選択（2Dでは形状の頂点を返す。2D/3Dプリミティブを配置可）
| verts | translate x y z   # 頂点位置をオフセット（選択を維持）
| points [...]     # 座標で点を指定
| points (polar n r)     # 円形配置
| points (grid nx ny p)  # 格子配置
| points ... | translate x y z  # ポイント位置をオフセット（選択を維持）
```

Face選択の後では `polar` / `grid` を直接書ける（`points` を省略可）:

```
| faces top | polar 6 20 | hole 3     # points (polar 6 20) と同じ
| faces top | grid 2 3 20 | hole 3    # points (grid 2 3 20) と同じ
```

### セレクタ記号

| 記号 | 意味 | 例 |
|---|---|---|
| `>` | 最大方向 | `faces >Z` — 上面 |
| `<` | 最小方向 | `faces <Z` — 底面 |
| `=` | 軸または平面に平行（辺・面そのものの向き） | `edges =Z` — 縦の4辺 / `faces =Z` — 側面4枚 / `edges =XY` — 水平な8辺 / `faces =XY` — 上面+底面 |
| `+` `-` | 面の向き（法線）。面専用 | `faces +Z` — 上を向く面 / `faces -Z` — 下を向く面 |

`>Z` だけが「1枚」を選ぶ。`faces =XY` は上面+底面の2枚、`faces =Z` は側面4枚
(60×40×30 の箱なら面積 4800 と 6000)。`+Z` は箱では `>Z` と同じ1枚だが、段差があれば上を向く面すべて。

### 名前エイリアス

| エイリアス | 等価 |
|---|---|
| `top` | `>Z` |
| `bottom` | `<Z` |
| `right` | `>X` |
| `left` | `<X` |
| `front` | `<Y` |
| `back` | `>Y` |

エイリアスが効くのは `faces` / `edges` / `verts` の引数位置だけ。他では普通の変数名(`top = 20` は可)。変数に束縛するなら記号で `$s = >Z`。

### 複合セレクタ

```
| edges >Z >X          # AND: Z最大 かつ X最大
| edges [>Z, <Z]       # OR: Z最大 または Z最小
```

### 名前付け（as）

```
| faces <X as $left     # 面に名前を付けて後から参照
| edges =Z as $top_edges
```

### ワークプレーン

```
| faces top | rect 50 30      # Face選択から直接2D描画（暗黙workplane）
| faces top | workplane XZ    # 軸を明示したい場合のみ workplane を書く
# 平面名: XY(+Z) XZ(+Y) YZ(+X)。-XY/-XZ/-YZ は同じ平面で法線が逆(押し出しが負側)。ZX 等の逆順はエラー
```

---

## 配置 `at:`

`at:` は名前付き引数。単純な座標はカッコ省略推奨。式を含む場合はカッコ必須。

```
cylinder 2.5 10 at:20 10                 # 単一位置（カッコ省略推奨）
cylinder 2.5 10 at:(20, 10)              # カッコ付きも有効
cylinder 2.5 10 at:[(0,0), (20,10)]      # リスト（ブラケット必須）
rect 10 5 angle:45                       # 回転（angle: 名前付き引数）
box 10 10 3 | polar 6 20                 # 円形配列（3Dコンテキスト）
box 10 10 3 | grid 4 3 20               # 格子配列（3Dコンテキスト）
```

Face選択コンテキストでは `polar`/`grid` は `points` として解釈される:

```
box 10 10 10 | faces top | polar 6 20 | circle 3 | cut   # 点を円形配置
box 10 10 10 | faces top | grid 2 3 20 | circle 3 | cut  # 点を格子配置
```

---

## 構文

### 変数

```
$w = 80
box $w $w/2 10
```

### 関数定義

```
def name($args) = pipeline
lift(box 10 10 10 | fillet 1, 5)   # 括弧の呼び出し: 引数にコマンドもパイプも書ける。区切りは ,
cylinder r(3) 10                   # コマンドの引数の中の呼び出しは名前の直後に ( 。r (3) は arg.function-value
```

### インポート

```
import "gear"
```

### 条件式

```
if $x > 0 then $x else -$x
```

### リスト内包

```
[$i * 10 for $i in range(6)]
```

### 組み込み関数

角度はすべて**度**。これらの名前で `def` は作れない（`def.shadows-builtin`）。

| 関数 | 意味 |
|---|---|
| `sin(a)` `cos(a)` `tan(a)` | 三角関数（引数は度） |
| `asin(x)` `acos(x)` `atan(x)` `atan2(y, x)` | 逆三角関数（結果は度） |
| `sqrt(x)` `abs(x)` | 平方根、絶対値 |
| `floor(x)` `ceil(x)` `round(x)` | 切り捨て、切り上げ、四捨五入 |
| `min(a, b, ...)` `max(a, b, ...)` | 最小、最大（1個以上） |
| `radians(d)` / `rad(d)`、`degrees(r)` / `deg(r)` | 度とラジアンの変換 |
| `len(list)` | リストの長さ |
| `range(n)` / `range(a, b)` / `range(a, b, step)` | 整数のリスト（`b` は含まない） |
| `clear(a, b)` | 2つのソリッドが重ならなければ `true`（接するだけなら `true`） |
| `pi` | 円周率（定数） |

### 演算子（優先順位 高→低）

`**` → `*` `/` `//` `%` → `+` `-` → 比較（`==` `!=` `<` `>` `<=` `>=` `~`） → `and` → `or` → `|`

`a ~ b` は近似比較。大きい方の 1% 以内なら `true`（`assert` の `tol:` で変えられる）。

### 計測と検証（`.プロパティ` / `assert` / `print`）

```
$g = box 80 60 25 | faces >Z | shell 2
$g.volume  $g.area  $g.solids  $g.faces  $g.edges  $g.verts  $g.valid   # ソリッド
$g.bbox.x  $g.bbox.y  $g.bbox.z  $g.bbox.min  $g.bbox.max  $g.bbox.center  # 寸法と角
$s.area  $s.faces  $s.wires  $s.bbox                                      # 2D 形状

assert $g.solids == 1              # 意図を書く。破れたら error assert.failed、build は書き出さない
assert $g.bbox.x ~ 80              # 近似比較（既定 1%）
assert $g.volume ~ 15552 tol:5     # 絶対許容差 5
assert $g.volume ~ 15552 tol:0.1%  # 相対許容差
assert clear($lid, $body)          # 干渉なし
print "vol" $g.volume $g.bbox      # 値を報告（info print）。verify / --json / live に出る
```

プロパティは変数や括弧の直後に密着させる（`$g.volume`、`($g | faces >Z).solids`）。
コマンドの引数にもそのまま書ける（`box $g.bbox.x 10 10`）。

---

## パラメータ（`@param` / `@profile`）

変数宣言の直前の行に `@param` を書く（**先頭に `#` を付けない**）。型は既定値から決まる（数値・文字列・`true`/`false`）。

```
@param 60..120 step:5 desc:"幅 (mm)"
width = 80
@param choices:["M3", "M4", "M5"] desc:"ねじ"
bolt = "M4"
```

オプション: `min` `max` `step` `desc` `label` `choices`（ドロップダウン） `group` `type` `hidden`。`@profile { "S": { ... }, "L": { ... } }` は複数の変数を一括で切り替えるプリセット。使い方の詳細は言語リファレンス (`references/language/index.md`)の「@paramアノテーション」「@profileアノテーション」。

## CLI

よく使うものだけ。全サブコマンドとオプションは `poly --help` にある。

| オプション | 説明 | 例 |
|---|---|---|
| `-o file` | 出力（.stl / .step / .glb / .svg / .png） | `poly build m.poly -o out.step` |
| `--view names` | SVG/PNG の視点（front/back/top/bottom/left/right/iso、カンマ区切り）。既定は front,top,right,iso | `poly build m.poly -o v.png --view iso` |
| `--view-size px` | SVG/PNG のパネルサイズ（既定240） | `poly build m.poly -o v.svg --view-size 480` |
| `--no-hidden` | 陰線（破線）を描かない | `poly build m.poly -o v.svg --no-hidden` |
| `-D key=value` | パラメータを上書き（複数指定可） | `poly build m.poly -D width=100` |
| `--params-file file` | JSON からパラメータを読み込み | `poly build m.poly --params-file p.json` |
| `--mesh-deflection val` | STL/glTF のメッシュ精度（既定0.1、大きいほど粗い） | `poly build m.poly --mesh-deflection 0.05` |

`-D` の値は `@param` の型で検査する: bool は `true`/`false` のみ、数値は数値のみ、`choices` は選択肢のいずれか。外れると `param.type` エラー（終了コード1）。文字列はそのまま渡る（`-D name=007` は `"007"`）

`-D` と `--params-file` を併用すると `-D` が優先。優先順位: `-D` > `--params-file` > `@param` デフォルト値

```bash
poly build box.poly -D width=100 -D height=50
poly build box.poly --params-file presets/small.json -D width=120
```

---

## 断面 `poly section`

平面で切って輪郭を報告する。画像ではなく**数値**で形を確かめるためのもの。

```bash
poly section m.poly                      # 既定 xz,yz（bbox中心を通る）
poly section m.poly --plane Z=10         # 位置を明示
poly section m.poly --plane xz,yz,Z=10   # 複数
poly section m.poly --plane Y=0 -o cut.svg
```

平面は**含む2軸**で呼ぶ（`xz` の法線はY）。位置を省くとbbox中心を通る。

```text
section XY @ Z=20: 2 loops
  loop 0: closed  bbox 39.999x39.9995 at (...)  area 1256.6371  length 125.6637  points 315
  loop 1: closed  bbox 15.999x15.9995 at (...)  area 201.0619   length 50.2655   points 199
```

ループが2つなら中空、1つなら充実。`area` と `length` は**解析曲線から測るので厳密**
（上はφ40の円柱にφ16の穴で、πr² と 2πr に桁まで一致）。`bbox` と `points` は
描画用にサンプリングした点由来なので、曲面ではわずかに内接する。
`area` に `~` が付くのは面が張れず多角形の面積を返した場合。

`-o` で書くSVGは**パス座標がミリメートル**で、表示倍率はgroup transformに置いてある。
`d="M 45.25 0 L 15 0 L 15 2 ..."` から床2mm・壁2mmが直接読める。

---

## コンテキスト遷移

```
3D ─→ faces/edges ─→ 2D ─→ extrude/cut ─→ 3D
              │        │
              │        └── hole ──→ 3D（面の中心に穴）
              │
              └── fillet/chamfer ──→ 3D

Face/Wire ─→ verts ──→ 2Dプリミティブ ─→ Face/Wire
       │    └─→ 3Dプリミティブ ─→ 3D
       │    └─→ translate ─→ verts（位置をずらして選択維持）
       │
points ──→ hole ──→ 3D（各ポイントに穴）
       └─→ translate ─→ points（位置をずらして選択維持）
```

覚え方: **作る → 選ぶ → 描く → 戻る**（`workplane` は省略可。面を選べばそのまま描ける）

`verts` で頂点を取ると、2D/3Dどちらのプリミティブも各頂点に配置できる。
`translate` で位置をずらしてから配置することもできる:

```
rect 100 100 | verts | circle 1      # 各頂点に円を配置 → 2D
rect 100 100 | verts | box 1 1 1     # 各頂点にboxを配置 → 3D
rect 80 60 | verts | translate 10 10 10 | cone 2 0 6   # 頂点をオフセットしてから配置
```
