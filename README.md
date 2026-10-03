# PolyScript

A pipe-based parametric CAD language built on OpenCascade that exports STL, STEP and glTF files.

```
box 80 60 10
 | fillet 2
 | faces >Z | workplane
 | circle 10 | cut
```

This is the TypeScript implementation. It ships as a single binary with the
OpenCascade kernel compiled to WebAssembly, so there is no runtime or CAD
kernel to install.

## Features

- **Pipe syntax** -- chain operations with `|` for readable modeling workflows
- **No install footprint** -- OpenCascade runs as WebAssembly inside the binary
- **Functions** -- define reusable parametric shapes with `def`
- **Import** -- split libraries into separate `.poly` files
- **Expressions** -- arithmetic, comparisons, `if/then/else`, list comprehensions
- **Parameters** -- override values from the command line without editing the source
- **Headless verification** -- `poly info` and `--trace` report what was actually built
- **Export** -- STL, STEP, glTF (`.glb`, keeps per-part colours)

## Download

https://github.com/objhub/polyscript-ts/releases

Download the archive for your platform, extract it, and put `poly` on your PATH.
The binary is self-contained.

## Quick Start

Create `hello.poly`:

```
box 30 20 10 | fillet 2
```

Build:

```bash
poly hello.poly                     # → hello.stl (default)
poly hello.poly -o hello.step       # export STEP
poly hello.poly -o hello.glb        # export glTF, colours included
```

```mermaid
flowchart LR
  src["hello.poly<br/>box 30 20 10<br/>#124; fillet 2"]
  subgraph poly
    lex["lexer<br/>tokens"]
    parse["parser<br/>AST"]
    val["validator<br/>context check"]
    ev["evaluator<br/>step by step"]
    occt[("OpenCascade<br/>WebAssembly")]
    lex --> parse --> val --> ev
    ev <--> occt
  end
  solid(["B-Rep<br/>solid"])
  mesh["tessellate<br/>triangles"]
  stl["hello.stl"]
  glb["hello.glb<br/>with colours"]
  src --> lex
  ev --> solid --> mesh
  mesh --> stl
  mesh --> glb
```

## Examples

### L-bracket

```
polyline [(0,0), (50,0), (50,5), (5,5), (5,30), (0,30)]
 | extrude 20
 | faces >Z | chamfer 1
```

### Hex nut

```
r = 10
polygon 6 r
 | extrude 8
 | faces >Z | circle 4 | cut
 | faces >Z | chamfer 1
 | faces <Z | chamfer 1
```

### Parametric function

```
def standoff(r, h, hole_r) = cylinder r h | diff cylinder hole_r h

box 80 60 3 | fillet 1
 | union (standoff 4 10 1.5 at:[(-30,-20,0), (30,-20,0), (-30,20,0), (30,20,0)])
```

### Spacer stack

```
cylinder 12 2
 | diff cylinder 5 3
 | faces >Z | workplane
 | circle 8 | extrude 10
 | diff cylinder 5 12
 | faces >Z | workplane
 | circle 12 | extrude 2
 | diff cylinder 5 16
```

### Flanged pipe with bolt holes

```
cylinder 25 5
 | faces >Z | workplane
 | circle 15 | extrude 30
 | diff cylinder 12 40
 | faces <Z | workplane
 | points (polar 6 20)
 | hole 5 depth:5
```

### Parameters

`@param` declares the allowed range; `-D` overrides the value at build time.

```
@param 20..120
width = 80

box $width 60 10 | fillet 2
```

```bash
poly plate.poly -D width=120 -o plate.stl
```

## Documentation

- [PolyScript User Document](https://polyscript.objhub.org)

## CLI

```text
poly [build] <input.poly> [-o <output>]
```

`build` is the default subcommand, so `poly model.poly` works.

| Flag | Description |
|------|-------------|
| `-o file.stl` | Export as STL (default: `<input>.stl`) |
| `-o file.step` | Export as STEP (`.stp` also accepted) |
| `-o file.glb` | Export as glTF binary, with `color` preserved per part |
| `-o file.svg` | Export as a line drawing: hidden-line removal per view, occluded edges dashed |
| `-o file.png` | The same drawing rasterised, for readers that take no SVG |
| `--format <fmt>` | `stl`, `step`, `glb`, `svg` or `png`; overrides the extension |
| `--view <names>` | SVG/PNG viewpoints, comma-separated: `front` `back` `top` `bottom` `left` `right` `iso`. One name draws a single panel; the default is `front,top,right,iso` |
| `--view-size <px>` | SVG/PNG panel size (default 240) |
| `--no-hidden` | SVG/PNG: omit occluded edges instead of dashing them |
| `--png-scale <n>` | PNG supersampling, 1-4 (default 2). Sharpens lines; does not change the image size |
| `-D, --define <k=v>` | Override a parameter (repeatable) |
| `--params-file <path>` | Read parameters from JSON (`-D` wins) |
| `--mesh-deflection <v>` | Mesh tessellation deflection (default 0.1; higher = coarser, smaller file) |
| `--ascii-stl` | Write ASCII STL instead of the default binary (about 6x larger; diff-friendly) |
| `--trace` | Per-step source line, selection (count and geometry), volume, solid and face counts |
| `--timing` | Stage times (parse/init/evaluate/export) on stderr; with `--trace`, a per-step `ms` column |
| `--strict` | Treat warnings as errors (exit 3) |
| `--json` | Machine-readable report on stdout |
| `-v, --verbose` | Print B-Rep info for the result |

Other subcommands:

```bash
poly verify model.poly         # everything needed to judge the result, in one call
poly verify model.poly --json  # the same report as one object
poly check model.poly          # parse and validate only (no kernel: milliseconds)
poly info model.poly           # bbox, volume, area, solids, validity, topology, fingerprint
poly section model.poly        # cut with a plane, report the contours in mm
poly section model.poly --plane Z=10 -o cut.svg
poly diff before.poly after.poly   # did the edit change the geometry, and where
poly explain selector.empty    # what a diagnostic code means and how to fix it
poly dump-ast model.poly [--pretty]
```

`poly section` answers what a picture cannot: it cuts the model with a plane and
prints the contours, measured on the analytic curves rather than on a mesh, so a
wall thickness or a bore diameter is read rather than estimated.

```text
$ poly section case.poly --plane Y=0
section XZ @ Y=0: 4 loops
  loop 0: closed  bbox 30.25x5.9 at (15,0)  area 68.3  length 72.3  points 6
  loop 1: closed  bbox 30.25x2 at (-45.25,0)  area 60.5  length 64.5  points 4
```

Two loops mean a hollow section, one means solid. `area` and `length` are exact
(a r=20 bore reads 1256.6371 and 125.6637 — pi*r^2 and 2*pi*r); `bbox` and
`points` come from the drawn path, which is sampled. With `-o` the same cuts are
written as SVG whose **path data is in millimetres**, the display scale parked in
a group transform, so the corners can be read straight out of the `d` attribute.

`poly verify` is the main way to catch a broken model without looking at it: it
parses, validates, builds, traces every step, measures the result and runs the
post-build checks, and it is strict by default (any warning exits 3). It writes
no file unless you pass `-o`.

```text
$ poly verify case.poly
#  line  op        context        sel  where                   volume    solids  faces
1  4     faces >Z  FaceSelection  1/6  c=(0,0,15) n=+Z a=4800  144000.0  1       6
2  5     shell 2   3D             -    -                       24832.0   1       11

✓ case.poly: 1 solid  bbox 80x60x30  volume 24832.0  faces 11  valid true  fp ce3907c3594f
```

The failures that matter here are the quiet ones: a boolean that cut nothing
still reports a valid single solid, and a selector that picked the side face
instead of the top reports the same `1/6`. So the trace carries the source
line, and the `where` column carries the centroid, normal and area of what was
selected -- `n=+Z` is the top face, and four side faces share no normal at all.

Every diagnostic has a **stable code**, a position and a fix:

```text
case.poly:7:4 error selector.empty: selector '>Z and =Z' matched 0 of 48 edges -- the next
operation would apply to everything or to nothing; '>Z' is the top, '=Z' is edges parallel to Z
```

`poly explain <code>` prints the long form; `poly explain` lists every code.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | File read error |
| 2 | Syntax error |
| 3 | Validation error (with `--strict`, warnings too) |
| 4 | Evaluation or export error |

## License

MIT
