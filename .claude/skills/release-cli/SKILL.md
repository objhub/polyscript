---
name: release-cli
description: Release the poly CLI (polyscript-ts) -- bump the version, run release-check, tag, push the tag and confirm the CI release. Not for live or objhub. Run only when the user invokes /release-cli.
disable-model-invocation: true
argument-hint: "[X.Y.Z]"
---

# poly CLI のリリース

`polyscript-ts` の `poly` バイナリを出す手順。**タグ `vX.Y.Z` の push が正しい手順**で、
資産は `.github/workflows/release.yml` が各 OS でビルド・smoke してから GitHub Release に上げる。
`make release-publish` は使わない(タグ push と二重になる)。背景は `devel/typescript.md` §リリース。

作業ディレクトリは `polyscript-ts/`。

## 0. 版を決める

- 引数 `$ARGUMENTS` があればそれを版にする。無ければ現在の版
  (`node -p "require('./packages/cli/package.json').version"`)と
  `git log --oneline v<現在の版>..main` を見て、次の版を提案し、ユーザーに確かめる。
  **既定はパッチ版を上げる**。言語仕様の変更(新しいプリミティブ、構文の追加・変更)でも
  マイナー版は上げない: 仕様が定まっていない出来たての言語なので(2026-10-03 ユーザー指示。
  v0.4.0 は `thread` 追加でマイナーを上げたが、それは誤り)。マイナー以上はユーザーが言ったときだけ。
- 版は `packages/cli/package.json` の `"version"` の1か所だけ。Makefile の `VERSION` もここを読む。
- `git tag -l vX.Y.Z` と `git ls-remote --tags origin vX.Y.Z` で、同じタグがまだ無いことを確かめる。

## 1. 出す中身を確かめる

```bash
git fetch origin
git status --short                  # 追跡中のファイルに未コミットの変更が無いこと
git log --oneline origin/main..main # これから出るコミット
git log --oneline main..origin/main # 空であること(空でなければ止めて相談)
```

- 未コミットの変更があれば止めてユーザーに聞く。勝手にコミットも stash もしない。
- `origin/main..main` に、この会話で作っていないコミットがあれば一覧を見せる
  (ユーザー自身の未 push の作業が一緒に出る)。

## 2. 版を上げて release-check

```bash
# packages/cli/package.json の "version" を X.Y.Z に書き換える
make release-check > <scratchpad>/release-check.log 2>&1; echo "exit $?"
tail -5 <scratchpad>/release-check.log   # "release-check OK — version X.Y.Z"
```

- release-check は test + fulltest(B-Rep 回帰)+ lint(生成物の鮮度を含む)+ binary-test。数分かかる。
- **通らなければ先へ進まない。** 版の書き換えを戻すかどうかはユーザーに聞く。
  `skill-data.ts is stale` は `make gen` で直る(直したら別コミットにする)。

## 3. コミットとタグ

```bash
git add packages/cli/package.json
git commit -m "release X.Y.Z"        # 本文なし。過去のリリースコミットと同じ形
git tag -a vX.Y.Z -m "poly vX.Y.Z"   # 注釈付きタグ
```

## 4. push — 取り消せない

push の直前に、出すコミットの一覧とタグ名を1行で示す。ユーザーがこの会話ですでに
「vX.Y.Z でリリース」と言っていれば、それを承認として進めてよい。

```bash
git push origin main
git push origin vX.Y.Z
```

タグを push したら CI が資産を公開する。失敗しても、タグの付け直し(削除して再 push)は
ユーザーの判断なしにしない。

## 5. CI と資産を確かめる

```bash
gh run list --limit 3                     # Release / vX.Y.Z の run-id
gh run watch <run-id> --exit-status > /dev/null 2>&1; echo "exit $?"
gh release view vX.Y.Z --json url,assets -q '.url, (.assets[].name)'
```

資産は次の3つがそろっていること:

- `poly-linux-x86_64.tar.gz`
- `poly-macos-arm64.tar.gz`
- `poly-windows-x86_64.zip`

CI が失敗したら `gh run view <run-id> --log-failed` で原因を読み、ユーザーに報告する。

## 6. 報告

リリースの URL、含まれたコミットの一覧(`git log --oneline v<前の版>..vX.Y.Z`)、
release-check と CI の結果を短く伝える。
