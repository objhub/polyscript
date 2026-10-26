# PolyScript language: Primitives

> GENERATED from docs/content/en/language.md (Primitives > Position Convention) -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

## Primitives

### Position Convention

3D primitives and `extrude` follow different placement rules along the Z axis. Mixing them without care is a classic source of misalignment.

| Operation | Z-axis placement | Example (height 10) |
|---|---|---|
| `box`, `cylinder`, `sphere`, `cone`, `torus`, `thread` | Centered at origin | z = -5..+5 |
| `extrude h` | Bottom-aligned (z=0 upward) | z = 0..10 |

In other words, the bottom face of `box 10 10 10` sits at z=-5, while `rect 10 10 | extrude 10` starts at z=0. When you put both in the same scene, their bottoms don't line up.

**Three ways to fix this:**

1. **`| floor`** -- Snap the bottom to z=0 (the easiest)
2. **`center:(true,true,false)`** -- Disable centering on the Z axis only
3. **`| translate 0 0 h/2`** -- Manually shift upward

```
# WRONG: want to stack a lid (extrude) on a body (box), but bottoms mismatch
body = box 80 60 100             # z = -50..+50
lid  = rect 80 60 | extrude 20  # z = 0..20
# lid floats near the middle of the body

# RIGHT: use floor to align the body, then stack
body = box 80 60 100 | floor               # z = 0..100
lid  = rect 80 60 | extrude 20            # z = 0..20
body | union (lid | translate 0 0 100)    # lid on top
```

