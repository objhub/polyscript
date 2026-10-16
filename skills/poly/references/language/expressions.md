# PolyScript language: Expressions

> GENERATED from docs/content/en/language.md (Expressions (Arithmetic, Comparison and Logic, Conditional, List Comprehension, Math Functions, Tuples and Lists)) -- do not edit.
> Change the docs page, then run: bun scripts/gen-skill-docs.ts

## Expressions

### Arithmetic

```
+  -  *  /  //  %  **
```

> **Note**: In greedy argument parsing, `+`/`-` are interpreted based on whitespace. `-5` (attached) is a negative number, `10 - 5` (spaces on both sides) is binary subtraction (= 5), and `10 -5` (space before, attached after) is two arguments (10 and -5). When in doubt, use parentheses.

### Comparison and Logic

```
==  !=  <  >  <=  >=  ~
and  or
```

`a ~ b` is approximate equality for numbers: `true` when the difference is within
1% of the larger value. `assert ... tol:` changes the tolerance (see "Measuring and
checking" below).

### Conditional

```
if condition then expr else expr
```

`if`/`then`/`else` is an expression, so it can be used inline:

```
$use_round = true
$shape = if $use_round then circle 10 else rect 20 15
$shape | extrude 5
```

A branch can be a shape command without parentheses. A pipe cannot sit inside a
branch: `|` binds loosest, so a `|` after the expression applies to the result of
the whole `if`. To pipe inside a branch, wrap it in parentheses:

```
if $use_round then circle 10 else rect 20 15 | extrude 5    # extrudes either one
if $flag then (circle 10 | extrude 5) else (rect 20 15 | extrude 3)
box 40 30 (if $deep then 20 else 10)                         # an if as an argument needs parentheses
```

### List Comprehension

```
[$expr for $var in range($n)]
```

Practical examples:

```
# Generate 6 boxes spaced 15mm apart
union [box 10 10 10 at:($i * 15, 0) for $i in range(6)]

# Concentric circles
[$r * 5 for $r in range(1, 6)]
```

Nested comprehensions are also supported:

```
# Generate a 2D grid
[[$i + $j * 10 for $i in range(3)] for $j in range(2)]
# → [[0, 1, 2], [10, 11, 12]]
```

### Math Functions

Angles are in **degrees**. A `def` cannot take one of these names (`def.shadows-builtin`), and a call with the wrong number of arguments stops at `poly check` (`call.arity`).

| Function | Arguments | Meaning |
|---|---|---|
| `sin(a)` `cos(a)` `tan(a)` | 1 | Trigonometry (argument in degrees) |
| `asin(x)` `acos(x)` `atan(x)` | 1 | Inverse trigonometry (result in degrees) |
| `atan2(y, x)` | 2 | Arctangent of y/x (degrees, quadrant-aware) |
| `sqrt(x)` `abs(x)` | 1 | Square root, absolute value |
| `floor(x)` `ceil(x)` `round(x)` | 1 | Round down, up, to nearest |
| `min(a, b, ...)` `max(a, b, ...)` | 1 or more | Smallest, largest |
| `radians(d)` / `rad(d)`, `degrees(r)` / `deg(r)` | 1 | Degrees <-> radians |
| `len(list)` | 1 | Length of a list |
| `range(n)` / `range(a, b)` / `range(a, b, step)` | 1-3 | List of integers: `range(5)` is `[0,1,2,3,4]`; `b` is excluded; `step` may be negative (0 is an error) |

Constant: `pi`

### Tuples and Lists

```
(10, 20, 30)              # tuple
[(0,0), (10,5), (20,0)]   # list
```

