# PolyScript language: Measuring and checking

> GENERATED from docs/content/en/language.md (Measuring and checking (Properties, assert, print)) -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

## Measuring and checking

A dot after a shape variable reads a value the kernel measured. `assert` checks an
intent against those values and `print` reports them. Neither touches the geometry.

### Properties

```
$g = box 80 60 25 | faces >Z | shell 2

$g.volume      # volume
$g.area        # surface area
$g.solids      # number of solids (anything but 1 means parts never fused)
$g.faces  $g.edges  $g.verts   # face, edge and vertex counts
$g.valid       # whether OCCT accepts the B-Rep (true / false)
$g.bbox        # bounding box, with .x .y .z (sizes) and .min .max .center (lists of coordinates)
```

A 2D shape (Face / Wire) has `area`, `faces` (regions), `wires` (curves) and `bbox`.

The name sits **right after** the variable or the closing parenthesis. It works on a
parenthesised pipeline and inside a command's arguments:

```
($g | faces >Z).solids
box $g.bbox.x 10 10
```

An unknown name stops with `attr.unknown` and lists the names that exist.

### assert

```
assert $g.solids == 1
assert $g.bbox.x <= 80 and $g.bbox.y <= 60
assert $g.volume ~ 15552             # approximate: within 1% of the larger value
assert $g.volume ~ 15552 tol:5       # absolute tolerance, same unit
assert $g.volume ~ 15552 tol:0.1%    # relative tolerance
assert clear($lid, $body)            # the two solids share no volume (touching counts as clear)
```

The condition is any boolean expression. A broken `assert` is an **error**,
`assert.failed`, but evaluation carries on to the end: one run reports every
assertion, and the trace lists each one as an `assert ...` row marked `pass` or
`FAIL`. `poly verify` and `poly build` then exit with code 3, and `build` writes no
file. The message quotes the measured values on both sides:

```
m.poly:7:1 error assert.failed: assert $g.solids == 2 failed (left: 1, right: 2)
```

`tol:` goes at the end of the `assert` and applies only to the `~` in that condition.

### print

```
print "vol" $g.volume $g.bbox      # vol 15552 80x60x25 at (-40,-30,-12.5)
print $g                           # solid 1 faces 11 volume 15552
```

Values are separated by spaces. The line is an `info` diagnostic with code `print`:
it appears in the `poly verify` report, in `--json` under `diagnostics`, and in the
Live status line. It never goes to stdout.

For a one-off reading without editing the file, `poly measure m.poly '$g.bbox.z'`
evaluates one expression against the built model.

