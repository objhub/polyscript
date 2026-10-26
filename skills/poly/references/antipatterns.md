# よくある間違いと正しい書き方

各項目は「❌ 書きがちなコード」「✓ 正しいコード」「症状」の3点セット。
**症状欄が「無音」のものが危険** — ビルドは成功し、形だけが違う。

診断が出ているなら、まず `poly explain <code>`(例 `poly explain selector.empty`)。
コードは安定しているので、この文書の該当項目を引く鍵として使える。
無音の失敗は `poly verify` の `where` 列(選択の重心・法線・面積)と
`check.*` 行で捕まえる。

---

## 1. セレクタが0件マッチ → filletが全エッジに化ける

最も検出しにくい失敗。**画像では絶対に分からない。**

```poly
# ❌ >Z のエッジで Z軸に平行なものは存在しない(上端の辺は水平)
box 60 40 30 | edges >Z =Z | fillet 3

# ✓ 上面の4辺を丸めたいなら
box 60 40 30 | edges >Z | fillet 3
# ✓ 垂直な4辺(角)を丸めたいなら
box 60 40 30 | edges =Z | fillet 3
```

**症状**: 0件マッチだと `fillet`/`chamfer` は**全エッジにフォールバックする**。
「上面だけ角丸」が「全体角丸」になる。体積・solids・BRepCheckすべて正常に見える。

**検出**: `selector.empty`(エラー、exit 4)。`--trace` の `sel` 列も `0/48` を示す。
0件が実害になる前にビルドが止まる。

---

## 2. セレクタのタイプミス → 全件選択

```poly
# ❌ 記号が抜けている(クォートで囲むと文字列として通ってしまう)
box 10 10 10 | faces "Z" | shell 2

# ✓ セレクタはクォートなしで書く
box 10 10 10 | faces >Z | shell 2
```

**症状**: 文字列の未知のセレクタは絞り込みを行わず**全6面が選択される**。
`selector.unknown`(警告)が出るがビルドは成功する。`poly verify` は既定で strict
なので exit 3 で止まる。`sel` 列が `6/6`、`where` 列に共通法線が出ないのが痕跡。

クォートなしなら同じ間違い `faces Z` は「未定義変数 Z」のエラーで止まる。
セレクタは常にクォートなしで書く(`faces >Z`、`edges =Z >X`、`edges [>Z, <Z]`)。
クォート付き `faces ">Z"` は互換のため動くが非推奨。

---

## 3. 側面は `=Z`、上面+底面は `=XY`、上を向く面は `+Z`

```poly
# ❌ 上面だけ開けるつもりで、上を向く面すべて(段差の棚も)を開けている
stepped | faces +Z | shell 2

# ✓ 位置で選ぶ: 最も高い面1枚
stepped | faces >Z | shell 2
```

セレクタは**辺・面そのものの向き**で読む(面の法線ではない):

| セレクタ | 選択 | 60×40×30 の箱での面積 |
|---|---|---|
| `>Z` | 最も高い面1枚(位置) | `a=2400` (`n=+Z`) |
| `+Z` | 上を向く面すべて(向き)。箱では `>Z` と同じ、段差があれば複数 | `a=2400` |
| `=XY` | XY平面に平行な面 = 上面+底面 | `a=4800` |
| `=Z` | Z軸を含む面 = 側面4枚 | `a=6000` |

辺も同じ読み方: `edges =Z` は縦の4辺、`edges =XY` は水平な8辺。`+Z` `-Z` は面専用で、
辺に使うとエラー。「垂直」のセレクタはない(Z軸に垂直な辺は `=XY`)。

**症状**: 想定と違う面が中空化される。個数(`4/6`)より `where` 列の面積で見分けるのが速い。
なお `faces =Z | shell` は6面のうち4面を除去する要求なので、OCCT が
`shell: operation failed` で拒否する(上面だけ開けたいなら `>Z`)。

---

## 4. `front` と `back` の向き

```
top    = >Z      bottom = <Z
right  = >X      left   = <X
front  = <Y      back   = >Y     ← front が「マイナス側」
```

**症状**: 逆の面に穴が開く。`where` 列の重心で判別する
(`c=(0,-20,10)` なら front 側、`c=(0,20,10)` なら back 側)。

---

## 5. プリミティブは原点中心、`extrude` はz=0基準

```poly
# ❌ 蓋が本体の中にめり込む
body = box 80 60 20
lid  = rect 80 60 | extrude 3 | translate 0 0 10

# ✓ 基準を揃えてから積む
body = box 80 60 20 | floor          # z=0..20 になる
lid  = rect 80 60 | extrude 3 | translate 0 0 20
```

`box`/`cylinder`/`sphere`/`cone`/`torus`/`wedge` は原点中心(z=-h/2..+h/2)。
`extrude h` は z=0..h。混在させるなら `| floor` で底面をz=0に揃える。

**症状**: 部品がずれて重なる、または浮く。
`solids` が2以上なら浮いている(`check.multiple-solids`)。

---

## 5b. 部品が離れていると `union` しても1体にならない

```poly
# ❌ shell の床厚は wall_t(2mm)。床が3mmのつもりでボスを z=3 に置くと1mm浮く
body = box 80 60 25 | floor | faces >Z | shell 2
boss  = cylinder 4 15 | floor | translate 0 0 3

# ✓ shell の床厚は wall_t と同じ
boss  = cylinder 4 15 | floor | translate 0 0 2
```

床だけ厚くしたいなら、`shell` の後に床板を別途 `union` する。

**症状**: ビルドもエクスポートも成功し、見た目も正常。
`solids` が2以上になるのが唯一の手がかり(`check.multiple-solids`)。

**融合の条件**(実測で確認):

| 接触の仕方 | 融合するか |
|---|---|
| 体積が重なっている | する |
| 面で接している(ボスの底が床の上面に乗る) | **する** |
| 線で接しているだけ(円柱が平面に接線接触) | **しない** |
| 離れている | しない |

つまり「少し重ねる」必要があるのは**曲面どうし・曲面と平面が接する場合**だけ。
平らな面どうしが接していれば重ねなくてよい。迷うなら 0.5〜1mm 重ねておけば確実。

`solids > 1` は「融合されていない」という意味であって、必ずしもエラーではない
(接触していない複数パーツを意図的に出力することもある)。
**1個の部品として印刷したいのに2以上なら、位置がずれている。**

---

## 6. `sketch` は自動で閉じるので `sweep` のパスに使えない

```poly
# ❌ sketch は常に閉じたワイヤーになる
sketch [(0,0), (10,0), (10,10)] | sweep (circle 2)

# ✓ 開いたパスは wire
wire [(0,0), (10,0), (10,10)] | sweep (circle 2)
```

`sweep` は**パイプ側がパス、引数が断面**: `helix 5 30 10 | sweep (circle 2)`。
逆に書くと意図と違う形になる。

---

## 6b. XY で描いた 2D を `rotate` / `translate` で立てようとする

```poly
# ❌ 2D 形状は描いたワークプレーンから出られない。3角度の rotate はエラー(arg.count)
arc (0, -25) (25, 0) center:(0, 0) | rotate 90 0 0 | sweep (circle 5)
# ❌ 2D 形状に translate はない(context.invalid-op)
arc (0, -25) (25, 0) center:(0, 0) | translate 0 0 10 | sweep (circle 5)

# ✓ 縦の面で最初から描く
workplane XZ | wire [arc (0, -25) (25, 0) center:(0, 0)] | sweep (circle 5)
# ✓ または 3D 座標で書く
arc (0, 0, -25) (25, 0, 0) center:(0, 0, 0) | sweep (circle 5)
```

2D 形状の `rotate` は**1角度の面内回転**(`rect 10 10 | rotate 45 | extrude 5`)、`mirror` は面内の反転。
ソリッドの `rotate` は3角度ちょうど。個数を省略・超過するとエラーで、補われも無視もされない。

同じ誤解で、`move` / `moveto` を「形を動かす」と思って書くと何も起きない。これは**次に描く位置**を
動かすカーソル操作で、`rect 10 10 | move 5 5 | extrude 5` は原点の四角をそのまま押し出す(エラーも出ない)。
形を置く位置は描くときに `rect 10 10 at:(5, 5)` のように指定する(面の上なら `faces >Z | move 5 5 | rect 10 10` のように描く前に動かす)。

---

## 7. `[]` は常にリストリテラル。形状の結合は `union` を明示

```poly
# ❌ 形状を並べただけではリストになる
[box 10 10 10, sphere 7]

# ✓
union [box 10 10 10, sphere 7]
```

---

## 8. `bezier` / `spline` のリスト規約が文脈で違う

```poly
# 単独コマンド: リスト先頭に開始点を含める
spline [(0,0,0), (10,5,5), (20,0,10)] | sweep (circle 3)

# sketch/wire のセグメント内: 開始点は前セグメント末尾から暗黙に継承。
# 制御点/通過点と終点のみ書く
sketch [(5,0), spline [(8,3), (10,7)], (0,7), (5,0)]
```

---

## 9. マイナス記号の空白ルール

```poly
a = -5        # 単項マイナス(負数)
b = 10 - 5    # 二項減算
c = 10 -5     # ❌ 曖昧。greedy引数解析で意図とずれる
```

引き算は必ず両側に空白を入れる。負のリテラルは空白を入れない。

形状演算子 `+ - *`（union/diff/inter）も同じ規則の上に乗っているので、**コマンドの引数の直後には書けない**:

```poly
# ❌ 引数の算術と解釈される: box 10 10 (10 - ...) → パースエラーか型エラー
box 10 10 10 - cylinder 3 20
box 10 10 10 - (cylinder 3 20)

# ✓ 変数か括弧の間で使う
(box 10 10 10) - (cylinder 3 20)
base - holes | edges >Z | fillet 2

# ✓ コマンドの直後に続けるならパイプ形
box 10 10 10 | diff (cylinder 3 20)
```

---

## 10. `polar` / `grid` はコンテキストで意味が変わる

```poly
# 3Dコンテキスト: 形状を配列複製する
cylinder 3 20 | polar 6 20

# 面選択後: 穴あけ位置の点群になる(points の省略形)
box 60 60 10 | faces >Z | polar 6 20 | hole 3
```

---

## 11. パイプ操作の `floor` と数学関数 `floor(x)` は別物

```poly
box 10 10 10 | floor      # 底面をz=0に揃えるパイプ操作
n = floor(7 / 2)          # 数学関数(3)
```

---

## 12. コンテキスト違反(バリデータが弾く)

```poly
# ❌ shell は面選択が必要。エッジ選択後には置けない
box 10 10 10 | edges >Z | shell 2
# ✓
box 10 10 10 | faces >Z | shell 2

# ❌ extrude は2Dプロファイル用。すでに3D
box 10 10 10 | extrude 5
# ✓
rect 50 30 | extrude 5

# ❌ hole は面選択かポイント選択が必要
box 10 10 10 | edges >Z | hole 3
# ✓
box 10 10 10 | faces >Z | hole 3
```

`wire [...]` は曲線(Wire)で、閉じても面(Face)にはならない:

```poly
# ❌ Wire に extrude はできない(以前は黙って閉じて三角柱になった。今はエラー)
wire [(0,0), (10,0), (10,10)] | extrude 5
# ✓ 閉じた輪郭は sketch で描く(Face)
sketch [(0,0), (10,0), (10,10)] | extrude 5
# ✓ 線に太さを与えたいなら offset(Wire → Face)
wire [(0,0), (10,0), (10,10)] | offset 1 | extrude 5

# ❌ 対象の面に何も描いていないのに 2D のツールで diff(リストは fold なので source にならない)
box 40 30 10 | faces >Z | diff [rect 10 10, circle 3] | cut 2
# ✓ 先に外形を描く、または place で 2D 形状を組んでから置く
box 40 30 10 | faces >Z | rect 10 10 | diff (circle 3) | cut 2
box 40 30 10 | faces >Z | place (rect 10 10 | diff (circle 3)) | cut 2
```

ブーリアンの両辺は **ソリッドどうし**か **Face どうし**。混ぜると
`diff: cannot combine a solid with a face. Both operands must be solids, or both faces ...`
になる(`(rect 10 10) + (box 5 5 5)`、`union [rect 10 10, box 5 5 5]` も同じ。以前は黙って片方を捨てていた)。

**症状**: `poly check` が `context.invalid-op` (exit 3) で拒否し、
行番号・キーワード名・有効なコンテキストの一覧・ヒントを示す
(`'rect' is not valid in 3D context (allowed in: Workplane, Face, ...) -- select a face to draw on first`)。
変数越しでバリデータを通り抜けた場合も、ランタイムが同じ趣旨のエラーを出す
(`extrude: nothing to extrude -- the context holds a solid, not a face`)。
どの操作がどのコンテキストで使えるかは `context-model.md` を参照。

---

## 13. `workplane` は面選択が空だと原点に戻る

```poly
# ❌ 面が選べていないと、原点のXY平面にスケッチが描かれる(文字列の綴り間違いは通ってしまう)
box 10 10 10 | faces "Z" | workplane | circle 3 | cut

# ✓
box 10 10 10 | faces >Z | workplane | circle 3 | cut
```

**症状**: 選択面上ではなく原点に描画される。0件マッチなら `selector.empty` で止まるが、
「別の面が1枚選ばれた」場合は `where` 列の法線で確かめるしかない。

---

## 14. `hole` は面選択が空だと何もしない

**症状**: 穴が開かないままエクスポートが成功する。
`poly verify` が `check.no-effect` として報告する
(体積が動いていない材料除去の op を全部拾う)。

---

## 既知の制限(実装側の問題。回避するしかない)

| 制限 | 内容 |
|---|---|
| shell後のfillet | OCCTの制限で動作しない。`fillet` を先に、`shell` を後に |
| `arc radius:` | 中心候補が2つある場合に曖昧。`center:` か3点指定を使う |
| `thread` | 未実装 |


## ブーリアンツールを対象の表面にちょうど接しさせる

**症状**: diff の結果に体積ほぼゼロの屑ソリッドが混ざり(`--trace` の solids が
2以上)、STL の溝の中に迷い三角形が見える。ブーリアンも異常に遅い。

**誤**: 溝プロファイルの外縁を円柱表面ぴったりに置く

```poly
groove = polyline [(0, -0.5), (-1.4, 0), (0, 0.5)]   # 外縁が x=0 = 表面上
cylinder 4 25 | diff (helix 1.5 25 4 | sweep groove)
```

**正**: フランク線を延長してツールを表面からはみ出させる(切削形状は同一)

```poly
lead = 0.5
groove = polyline [(lead, -(0.5 * (1 + lead / 1.4))),
                   (-1.4, 0),
                   (lead, 0.5 * (1 + lead / 1.4))]
cylinder 4 25 | diff (helix 1.5 25 4 | sweep groove)
```

接面(tangent)のブーリアンは OCCT が最も苦手とするもので、µm厚の屑ソリッドを
量産し、処理時間も数倍かかる(19_iso_bolt の実測で 15ソリッド→1、
TS 28.6s→5.6s)。diff/inter/union のツール・対象は、意図した面以外では
**重なるか離れるか**のどちらかにし、「ちょうど接する」を避ける。


## ねじ山を完全に尖らせようとしてツールを隣のターンと接触させる

**症状**: `diff` までは solids 1 で通るのに、続く `inter` が **volume 0 / solids 0**
を返し、以降の union で頭だけが残る。警告なし・exit 0 のサイレント失敗。

**誤**: 山の平坦部をゼロにするため溝幅をピッチいっぱいに取る

```poly
hw = pitch / 2            # 表面で隣の溝とちょうど接する
groove = polyline [(lead, -(hw * (1 + lead / gd))), (-gd, 0), (lead, hw * (1 + lead / gd))]
```

**正**: 山の平坦部を ISO どおり pitch/8 残し、ツールの最外周幅を pitch/2 未満に抑える

```poly
land = pitch / 8
hw = (pitch - land) / 2
gd = hw * 1.7320508       # 60° フランク
lead = gd / 8             # hw*(lead+gd)/gd = 1.125*hw < pitch/2
```

ねじ山(crest)は**隣り合う溝の間に残る材料**なので、完全に尖らせる = 溝同士が
表面で接する = 螺旋掃引したツールが隣のターンと接面する。`lead` のはみ出しがあれば
自己交差になり、そのツールで切った結果に対する次のブーリアンが黙って空になる。
ISO が山を P/8 切り落としているのは加工上の理由だけではなく、幾何的にも退化を
避けるためと考えてよい。ガードは「ツールの最外周での半幅 `hw·(lead+gd)/gd` が
`pitch/2` を下回ること」。実測では 1.03 倍程度までは通るが、1.27 倍で破綻した。

ついでに: OCCT 7.9.3(Python 側)の `MakePipeShell` は、細長い三角プロファイルで
`lead` を小さくしすぎるとツールを**裏返し**(sweep の体積が負)にし、diff が何も
削らない。8.0.1(TS 側)では起きない。`lead` はゼロ近くまで詰めないこと。
