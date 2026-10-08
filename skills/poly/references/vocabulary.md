# vocabulary

> GENERATED from docs/content/ja/vocabulary.md -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

「角を丸めたい」「肉抜きしたい」——頭にある言葉から操作を引くための表。
構文そのものは`references/cheatsheet.md`にある。

## 形をいじる

| 日本語 | 操作 | 例 |
|---|---|---|
| 角丸・R・丸める | `fillet r` | `edges =Z \| fillet 3` |
| 面取り・C面・角を落とす | `chamfer c` | `edges >Z \| chamfer 1` |
| 肉抜き・中空化・器にする | `faces` + `shell t` | `faces >Z \| shell 2` |
| くり抜く・削る・引く | `diff` | `\| diff (cylinder 5 30)` |
| 足す・くっつける | `union` | `\| union $boss` |
| 重なりだけ残す | `inter` | `\| inter (sphere 20)` |
| 穴・穴あけ | `hole r` | `faces >Z \| hole 3` |
| 皿穴・座掘り | 段付き `hole` を2回 | `hole 3.4` の後に浅い `hole 6` |
| 貫通穴 | `hole r`(深さ省略) | 省略すると貫通する |
| 溝・スリット | 細い `box` を `diff` | `\| diff ($slot)` |
| オフセット・逃げ | `offset d` | `\| offset -1`(内側) |
| 板を厚くする | `extrude` の値 | — |

## 立体をつくる

| 日本語 | 操作 | 例 |
|---|---|---|
| 押し出す | `extrude h` | `rect 50 30 \| extrude 10` |
| ロクロ・回転体・器・コップ・茶碗・花瓶 | `sketch` + `revolve` | `sketch [...] \| revolve Y` |
| 断面を描く | `sketch [...]` | 閉じたプロファイル |
| パスに沿わせる・パイプ・チューブ | `wire`/`helix` + `sweep` | `wire [...] \| sweep (circle 3)` |
| ばね・ねじ山の道筋 | `helix` + `sweep` | `helix 5 30 10 \| sweep (circle 2)` |
| 断面をつないで絞る | `loft` | `rect 40 40 \| loft [rect 20 20] 30` |
| テーパー・抜き勾配 | `extrude h draft:deg` | `extrude 20 draft:3` |
| くさび・斜面 | `wedge` | `wedge 20 10 15 5` |

## 位置と向き

| 日本語 | 操作 | 備考 |
|---|---|---|
| 動かす・ずらす | `translate x y z` | |
| 回す・傾ける | `rotate rx ry rz` | `origin:"local"` で自身の中心基準 |
| 拡大縮小 | `scale s` | |
| 左右反転・鏡像 | `mirror "X"` | |
| 接地させる・底をz=0に | `floor` | **プリミティブは原点中心なので必須になりがち** |
| 並べる・格子状 | `grid nx ny pitch` | |
| 円形に並べる | `polar n r` | |
| 面の上に置く | `faces` + `place` | |

## 部品の呼び名

| 日本語 | つくり方 |
|---|---|
| ボス(ねじ受けの円柱) | `cylinder` を `union` してから `hole`(下穴径) |
| リブ(補強の板) | 薄い `box` を `union` |
| フランジ | 薄い大径 `cylinder` を `union` |
| 高台(こうだい) | 底面側に環状の `cylinder` を `union`、内側を `diff` |
| 水切り | `grid` + `hole`、またはリブを並べる |
| 爪・フック | L字の `box` を `union` |
| 蓋 | 本体と同じ外形を `extrude` し、`offset -クリアランス` で内側の嵌合部を作る |
| はめあい・嵌合 | クリアランスは `dimensions.md` を見る |

## 選択の言い方

| 日本語 | セレクタ |
|---|---|
| 上面 | `>Z` または `top` |
| 底面 | `<Z` または `bottom` |
| 側面 | `+Z`(法線がZに垂直な面) |
| 右面 / 左面 | `>X` / `<X` |
| 手前 / 奥 | `<Y`(front) / `>Y`(back) |
| 縦のエッジ(角) | `edges =Z` |
| 上面の外周 | `edges >Z` |
| 全部 | セレクタを省略する |

`+Z` は上面ではなく側面。`front` はマイナス側。どちらも間違いやすい
(`antipatterns.md` の3と4)。
