# レシピ集

**ここに載っているコードは全て `poly build --strict` で検証済み。**
体積を手計算と突き合わせて意図通りであることも確認してある。

---

## 1. 箱型ケース(角丸・中空・上面開口)

```poly
@param 40..200 desc:"幅 (mm)"
w = 80
@param 40..200 desc:"奥行 (mm)"
d = 60
@param 10..100 desc:"高さ (mm)"
h = 25
@param 1.2..5 step:0.1 desc:"肉厚 (mm)"
t = 2
r = 3

box w d h
 | floor
 | edges =Z | fillet r
 | faces >Z | shell t
```

順序が重要: **`fillet` を先、`shell` を後**。逆にすると OCCT の制限で
`shell` 後の `fillet` が失敗する。`floor` は底面をz=0に置くため。

---

## 2. ボス(ねじ受け)を四隅に立てて下穴をあける

M3用。下穴 φ2.5 なので `pilot_r = 1.25`。

```poly
plate_w = 80
plate_d = 60
plate_t = 3
boss_r  = 4
boss_h  = 8
pilot_r = 1.25
inset   = 10

ox = plate_w / 2 - inset
oy = plate_d / 2 - inset

plate = box plate_w plate_d plate_t | floor
boss  = cylinder boss_r boss_h | floor | translate 0 0 plate_t
pilot = cylinder pilot_r (plate_t + boss_h) | floor

bosses = union [
  boss | translate ox oy 0,
  boss | translate ox (oy * -1) 0,
  boss | translate (ox * -1) oy 0,
  boss | translate (ox * -1) (oy * -1) 0
]

pilots = union [
  pilot | translate ox oy 0,
  pilot | translate ox (oy * -1) 0,
  pilot | translate (ox * -1) oy 0,
  pilot | translate (ox * -1) (oy * -1) 0
]

plate | union bosses | diff pilots
```

穴は「ボスと同じ位置に円柱を並べて `diff`」で開けるのが確実。
`faces >Z | grid ... | hole` を使うとボスの上面と板の上面が混ざって
意図しない位置に開く。

検証: 体積 15792.51 = 板 14400 + ボス 4×π×16×8 − 下穴 4×π×1.25²×11。

---

## 2b. 基板ケース(壁の中にボスを立てる)

レシピ1と2の組み合わせ。要注意は **`shell` の床厚が `wall_t` と同じ**になること。
別の床厚を仮定してボスを置くと1mm浮いて別ソリッドになる。

```poly
case_w  = 80
case_d  = 60
case_h  = 25
wall_t  = 2
corner_r = 3

boss_r  = 4
boss_h  = 15
pilot_r = 1.25      # M3タップ下穴 φ2.5
pilot_h = 12
overlap = 1         # 内壁への食い込み。接するだけでは別ソリッドになる

bx = case_w / 2 - wall_t - boss_r + overlap
by = case_d / 2 - wall_t - boss_r + overlap

body = box case_w case_d case_h
  | floor
  | edges =Z | fillet corner_r
  | faces >Z | shell wall_t

# shell の床は wall_t 厚なので、ボスは z = wall_t から立てる
boss  = cylinder boss_r boss_h | floor | translate 0 0 wall_t
pilot = cylinder pilot_r pilot_h | floor
  | translate 0 0 (wall_t + boss_h - pilot_h)

bosses = union [
  boss | translate bx by 0,
  boss | translate bx (by * -1) 0,
  boss | translate (bx * -1) by 0,
  boss | translate (bx * -1) (by * -1) 0
]

pilots = union [
  pilot | translate bx by 0,
  pilot | translate bx (by * -1) 0,
  pilot | translate (bx * -1) by 0,
  pilot | translate (bx * -1) (by * -1) 0
]

body | union bosses | diff pilots
```

検証: bbox 80×60×25、`solids` 1、下穴の体積減 235.6 = 4×π×1.25²×12。

ボスの底が床の上面(z = `wall_t`)に接していれば `overlap` が 0 でも融合する。
`translate 0 0 wall_t` を `translate 0 0 3` に変えると床から1mm浮き、
`solids` が 5 になる。

---

## 3. 回転体の器(コップ・茶碗・花瓶)

外形と内側の空洞をそれぞれ回転体にして引く。**`revolve Y` は軸がY方向**
になるので、印刷時は横倒しになる点に注意(必要なら `rotate` で立てる)。

```poly
cup_h  = 95
rim_r  = 40
base_r = 35
wall_t = 3
bot_t  = 4

ir_top = rim_r - wall_t
ir_bot = base_r - wall_t

outer = sketch [
  (0, 0), (base_r, 0),
  (rim_r, cup_h), (0, cup_h)
] | revolve Y

# 空洞は口側を少し伸ばして、ブーリアンの境界を面と重ねない
cavity = sketch [
  (0, bot_t), (ir_bot, bot_t),
  (ir_top, cup_h + 1), (0, cup_h + 1)
] | revolve Y

outer | diff cavity
```

断面スケッチは `x = 半径方向`, `y = 高さ` の2D座標で、**x >= 0** に収める。
曲線が欲しければ `spline [...]` をセグメントに挟む(`ex3/bowl.poly` 参照)。

---

## 4. 水切りの穴を格子状にあける

```poly
w = 120
d = 80
h = 15
t = 2.5
hole_r = 2.5

box w d h
 | floor
 | edges =Z | fillet 5
 | faces >Z | shell t
 | faces <Z | grid 5 3 20 | hole hole_r
```

`faces <Z | grid nx ny pitch` は「底面上に格子状の点を置く」の意味
(`points (grid ...)` の省略形)。`--trace` の `grid` 行が点数(この例なら15)を
報告するので、狙った穴数になっているか確認できる。

---

## 5. リブ(三角ガセット)で補強したL字ブラケット

```poly
arm    = 60
width  = 40
t      = 5
rib_t  = 4

vertical   = box t width arm | floor
horizontal = box arm width t | floor | translate (arm / 2 - t / 2) 0 0

# XZ平面に直角三角形を描いて、Y方向に押し出す
rib = workplane XZ
  | polyline [(t, t), (arm - t, t), (t, arm - t)]
  | extrude rib_t

union [vertical, horizontal, rib]
```

任意の平面上に断面を描きたいときは `workplane XY|XZ|YZ` から始める。

---

## 6. 面の上に任意断面を置いて抜く

```poly
slot = sketch [(5, 0), arc (5, 0) (0, -5) (-5, 0), (0, 7), (5, 0)]

box 40 40 20
 | faces >Z | place slot | cut
```

`place` は変数に入れた2D形状を選択面の上に配置する。`cut` は深さ省略で貫通。

---

## 7. 蓋(はめあい付き)

```poly
box_w = 60
box_d = 40
wall  = 2
lid_t = 3
clear = 0.2      # すべり嵌合

# 本体の内寸に対してクリアランス分だけ小さい嵌合部
inner = rect (box_w - wall * 2 - clear * 2) (box_d - wall * 2 - clear * 2)
  | extrude 4

rect box_w box_d
 | extrude lid_t
 | union (inner | translate 0 0 lid_t)
```

クリアランスの値は `dimensions.md` の表から選ぶ。

---

## 8. パイプ・チューブ

```poly
# 直線+円弧のL字パイプ
workplane XZ
 | wire [(0, 0), (40, 0), arc (40, 0) (50, 10) radius:10, (50, 40)]
 | sweep (circle 5)
```

`sweep` は**パイプ側がパス、引数が断面**。`sketch` は自動で閉じてしまうので
パスには `wire` を使う。

---

## 9. ばね・らせん

```poly
helix 5 40 12 | sweep (circle 2)
```

`helix pitch height radius`。

---

## 10. 円形配置

```poly
# 6か所に穴
cylinder 40 10
 | faces >Z | polar 6 25 | hole 3

# 6個の柱を円形に複製
cylinder 3 20 | polar 6 25
```

`polar n r` は3Dコンテキストでは形状の複製、面選択後では穴あけ位置の点群。
