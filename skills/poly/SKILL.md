---
name: poly
description: Build 3D models in PolyScript from a natural-language description (Japanese or English), then verify them without a human looking at the result. Use whenever the user asks for a .poly file, a 3D model, a printable part, or an edit to an existing model.
---

# PolyScript modeling

PolyScript is a pipe-based parametric CAD language. You write a pipeline, the
OpenCascade kernel builds a solid, and `poly` exports STL/STEP/glTF/OFF.

**The hard part is not writing the pipeline. It is knowing whether what you
built is what was asked for.** Several of the kernel's failure modes produce a
healthy-looking solid and exit 0: a selector that matched nothing, a `fillet`
that quietly widened to every edge, a `hole` that did nothing. You cannot see
any of them in a rendered picture. So the workflow below is built around
checking numbers first and looking at pixels last.

## Workflow

### 1. Turn the request into a dimension table, before writing any code

Natural-language requests are underspecified. Resolve every adjective into a
number and show the table, marking which numbers you assumed:

| item | value | source |
|---|---|---|
| 幅 (X) | 80 mm | 指定 |
| 奥行 (Y) | 60 mm | 指定 |
| 高さ (Z) | 25 mm | 指定 |
| 肉厚 | 2 mm | 仮定(3Dプリント最小1.2mmより安全側) |
| 用途 | 基板ケース | 指定 |
| 積層方向 | Z | 仮定 |

Rules:

- Units default to **mm**. 「センチ」/「cm」means x10. Never leave a bare number ambiguous.
- Adjectives must become numbers: 「小さめ」「厚め」「しっかり」are not dimensions.
  Pick a value, state it as an assumption, and continue -- do not stop to ask
  unless proceeding either way would waste real work.
- For anything that fits, holds, or screws into something else, look the
  clearance up in `references/dimensions.md`. Getting a tap hole wrong makes
  the part useless.
- Household object sizes come from `references/dimensions.md` too, which is
  derived from the author's own real-world models in `ex3/`. A teacup is 80mm
  across, not 500mm.

### 2. Write the model with `@param`

Expose the dimensions as parameters so a human can adjust them afterwards
without editing the pipeline:

```poly
@param 60..120 desc:"幅 (mm)"
width = 80
@param desc:"名前"
name = "NAME"                  # string: text input
@param desc:"彫り込みにする"
engrave = false                # bool: checkbox. true / false only
```

The annotation is **not a comment**: no `#` in front. `# @param` is an ordinary
comment, so the variable is not a parameter -- no GUI control, no `-D` type
check -- and `poly verify` warns `param.commented`. The type comes from the
default value (`80` int, `2.5` float, `"..."` string, `true`/`false` bool);
`-D engrave=true` overrides a bool, and anything but `true` / `false` is
rejected (`param.type`). Branch on it with `if engrave then text "A" 10 else circle 5`
-- a branch may be a bare command, but a pipe inside a branch needs
parentheses: `if engrave then (a | cut 1) else a`.

A fixed set of options (`bolt` M3 / M4 / M5) is `@param choices:[...]`, a
dropdown; `-D` then accepts only those values (`param.choice`). A `-D` number
outside `@param min..max` warns `param.range`, which `poly verify` fails on. `@profile { ... }` switches
several parameters at once. The options (`min max step label desc choices
group type hidden`) are named in `references/cheatsheet.md` and explained in
`references/language/param-annotation.md`; a misspelt option warns
`param.unknown-option`.

**Write the dimension table into the file as `assert` lines.** Bind the result
to a variable, state what must hold, then emit the shape:

```poly
$case = box width depth height | faces >Z | shell wall
assert $case.solids == 1                 # one piece
assert $case.bbox.x ~ width              # the size that was asked for (1% tolerance)
assert $case.bbox.z ~ height
assert clear($case, $lid)                # parts do not interfere
$case
```

A broken assert is `assert.failed` with the measured value quoted; `verify` and
`build` exit 3 and `build` writes nothing. The asserts outlive the session: the
next edit, by you or by someone else, is checked against the same intent. The
properties (`volume area solids faces edges verts bbox valid`, `bbox.x/y/z/min/
max/center`) and `~ ... tol:` are in `references/cheatsheet.md`. `print "name"
$case.volume` reports a value in the same report without failing anything.

Consult `references/cheatsheet.md` for syntax and `references/recipes.md` for
the standard shapes (enclosure, boss, rib, drainage grid, revolved vessel).
`references/vocabulary.md` maps the words of the request to operations.
It is installed in the language the person is likely to write in.

### 3. Verify with numbers -- every iteration, no images

```
poly verify model.poly
```

One call that parses, validates, builds, traces every
step, measures the result, fingerprints it, and runs the post-build checks. It
is **strict by default** -- any kernel warning exits 3 -- so a zero exit already
means nothing silent was reported. Nothing is written to disk unless you pass
`-o`. Add `--json` for the same report as one object.

Every line it prints carries a **stable code** (`selector.empty`,
`context.invalid-op`, `check.no-effect`, ...), a source position, and a fix:

```
case.poly:7:4 error selector.empty: selector '>Z =Z' matched 0 of 48 edges -- ...
```

`poly explain <code>` prints the long form. Do not guess at a rewrite before
reading it.

Read the trace table and confirm all of:

- [ ] no `sel` cell reads `0/N` -- this is an error now, so a zero exit already
      means it; the codes to recognise are `selector.empty` (matched nothing)
      and `selector.unknown` (unparsable, so *nothing* was filtered)
- [ ] the `where` column is the face you meant. This is what separates
      `faces >Z` (the top: `n=+Z`) from `faces =Z` (the sides: no shared
      normal), and it is the one mistake numbers alone used to miss:
      `c=` is the centroid of the selection, `n=`/`d=` its normal or direction,
      `a=` its area
- [ ] `solids` is 1 **if you meant one piece**. More than 1 means the parts were
      never fused -- either they genuinely do not touch, or they only touch (a
      boss sitting exactly on a wall does not join). Both print badly as a
      single part. `check.multiple-solids` says it in the report; several
      shipped examples are deliberately multi-solid, so investigate against
      your intent rather than treating it as an error
- [ ] `bbox` matches the dimension table from step 1 -- better, the table is
      in the file as `assert` lines and every `assert` row in the trace reads
      `pass`
- [ ] each step moved `volume` the way it should: `shell` and `hole` reduce it,
      `fillet` reduces it slightly *and* raises the `faces` count. A step that
      changed nothing is reported as `check.no-effect`

The `line` column is the line in your source, so a finding maps straight back
to the code to edit. The `fp` in the summary is a digest of the geometry: after
a refactor that was meant to leave the shape alone, `poly diff old.poly
new.poly` says whether it did, and names the fields that moved if not.

Example of the failure that has no visual signature:

```
#  line  op               context        sel    where               volume   solids  faces
1  3     faces >Z         FaceSelection  1/6    c=(0,0,15) n=+Z     72000.0  1       6
2  4     shell 2          3D             -      -                   15552.0  1       11
3  5     edges >Z =Z      EdgeSelection  0/48   -                   15552.0  1       11
```

Step 3 selected nothing. It now fails the build with `selector.empty` at line 5
instead of letting the next `fillet` widen to all 48 edges -- but the shape it
used to produce (rounded all over, plausible volume, valid B-Rep, exit 0) is
what to expect from any other selection mistake that still matches something.
That is what the `where` column is for.

**Do not render an image at this stage.** Images stay in context for the rest of
the session, so one per iteration is pure accumulated cost for information the
numbers already gave you.

### 4. When the numbers are suspicious, cut a section

```
poly section model.poly --plane xz,yz
```

This is **not an image**. It prints the loop table and writes an SVG whose path
coordinates are millimetres. Two loops mean hollow, one means solid; `area` and
`length` come off the analytic curves rather than a mesh, so they are exact:

```
section XZ @ Y=0: 1 loop
  loop 0: closed  bbox 60x30 at (-30,0)  area 232  length 180  points 8
```
```svg
d="M 30 0 L 30 30 L 28 30 L 28 2 L -28 2 L -28 30 L -30 30 L -30 0 Z"
```

Count the loops: two closed contours mean hollow, one means solid (a box shelled
with an open top is a single U-shaped contour, as above). Then read the wall
straight off the path -- 30 to 28 is a 2mm wall, 0 to 2 a 2mm floor. This is the
answer to the questions numbers cannot reach (is the interior actually hollow,
is the wall the thickness you asked for, does the hole go all the way through)
at a fraction of an image's cost, in a form you can quote back.

`area` and `length` are measured on the **analytic curves** (`poly section` cuts
with `sectionPlane`, so a cylinder sections to a circle, not to a polygon): a
r=20 bore reads area 1256.6371 and length 125.6637, which are pi*r^2 and 2*pi*r
to the digit. Only `bbox` and `points` come from the drawn path, which is
sampled -- they read a hair small on curves. An `~` after the area means the
loop could not be faced and the number is the polygon's.

**Never `Read` an .svg.** It is text, so it arrives as thousands of path
coordinates instead of a picture -- a single one can cost more context than the
whole model. Read the loop table; read `.png` only.

### 5. Look at the shape once, at the end

```
poly build model.poly -o views.png
```

Front / top / right / iso on one sheet, with OCCT hidden-line removal (occluded
edges dashed) and the view's name on each panel; add `--axes` for an XYZ gnomon
when the orientation is in doubt. **Ask for `.png`, and Read that** -- the
same call with `-o views.svg` writes thousands of path coordinates, which as
text costs thousands of tokens against a picture's ~320. This is for the two things numbers
genuinely cannot express: **is it the right shape**, and **is it the right way
up**. Orientation errors are common and invisible in the metrics -- `revolve Y`
puts a cup's axis along Y, so it comes out lying on its side.

### 6. Report, in the language the request came in

Answer in whatever language the person wrote to you in. This file is in
English because it is read by you, not by them; it says nothing about which
language they speak.

State the final dimensions, the assumptions you made, the print orientation,
whether supports are needed, and any overhang steeper than 45°.

## When something fails

Run `poly explain <code>` on the code in the diagnostic -- it names the cause
and the fix. Then read `references/antipatterns.md`. It lists the mistakes that actually get
made, each as a wrong version, a right version, and the symptom you would see.
**Do not guess at a rewrite** -- the failure modes here are asymmetric and
guessing usually swaps one for another.

If the validator rejects an operation, `references/context-model.md` has the
table of which operations are legal in which context, and what each one
transitions to.

## Reference files

The cheatsheet says what exists; `references/language/` says how it works.
**Before deciding a feature does not exist, or guessing at its options, look
it up**: find the topic in `references/language/index.md` and read that one
file (a few hundred to ~1700 tokens), not the whole reference.

| file | when to read it |
|---|---|
| `references/cheatsheet.md` | syntax lookup: primitives, pipe ops, selectors. It names **every** feature, briefly |
| `references/language/index.md` | how a feature works in full (its options, rules, edge cases). The index lists one file per topic with its size; read only the file you need, never all of them |
| `references/context-model.md` | a validation error about context |
| `references/antipatterns.md` | anything failed, or produced a surprising shape |
| `references/vocabulary.md` | turning the words of a request into operations |
| `references/dimensions.md` | screws, clearances, wall thickness, everyday object sizes |
| `references/recipes.md` | building a standard feature (boss, rib, vessel, grid of holes) |

## Command reference

The `poly` these scripts run is the shipping TypeScript binary
(`polyscript-ts/build/bin/poly`, built by `cd polyscript-ts && make binary`)
when present, otherwise whatever `poly` is on PATH (the Python CLI, now a
frozen oracle -- see python/README.md). Both expose the same surface below;
override with `POLY=/path/to/poly`.

```
poly verify FILE [--json] [--no-strict] [-o OUT]   # everything in one call: diagnostics,
                                                   # trace, B-Rep facts, fingerprint, checks
poly check  FILE [--json]     # parse + validate only. No kernel: milliseconds.
poly build  FILE -o OUT [--trace] [--timing] [--strict] [--json] [-D name=value]
poly info   FILE [--json]     # bbox, volume, area, solids, is_valid, topology, fingerprint
poly diff   A.poly B.poly [--json]   # did the edit change the geometry, and where
poly explain CODE             # the long form of a diagnostic code (no args: list them)
poly ops [KEYWORD] [--json]   # every operation's arguments, named arguments and contexts,
                              # from the implementation. Check here before guessing a key

poly measure FILE '<expr>' [--json]  # one value from the built model: '$lid.bbox.z', 'clear($a, $b)'
poly section FILE [--plane xz,yz|Z=10] [-o OUT.svg] [--json]   # loop table in mm
poly build FILE -o OUT.svg [--view iso|front,right] [--view-size 320] [--no-hidden]

stl2png IN.stl -o OUT.png                   # rotating APNG (for humans)
# stl2png is frozen: `--section` and `--views` are superseded by the two poly
# commands above, which are exact and need no STL round-trip. It stays
# installed as an independent cross-check, and for the APNG, which poly has no
# equivalent for.
```

Exit codes: `0` ok, `1` IO/usage, `2` syntax, `3` validation (or a warning under
`--strict`), `4` evaluation or export. Output format follows the `-o` extension:
`.stl` `.step` `.off` `.gltf` `.glb` `.py`.
