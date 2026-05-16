# Math & Computation Tools

This branch adds two custom structured tools for mathematical computation, layered on top of the existing upstream `Calculator` plugin.

## Tool inventory

| Tool | Plugin key | Engine | Auth required | Best for |
|------|-----------|--------|--------------|----------|
| Calculator (upstream) | `calculator` | `@librechat/agents` Calculator (mathjs) | No | Quick single-expression math |
| **Scientific Calculator** | `scientific_calculator` | mathjs 15.x (sandboxed) | No | PEMDAS, trig, stats, combinatorics, units, matrices |
| **Code Interpreter Math** | `code_interpreter_math` | Local code interpreter (Python) | No | Symbolic algebra, statistical tests, numerical methods, optimization |

## Scientific Calculator

### What it does

A structured tool that evaluates mathematical expressions using [mathjs](https://mathjs.org/) with a typed JSON schema so LLMs know exactly what operations are available.

### Supported operations

| Category | Examples |
|----------|---------|
| **Arithmetic (PEMDAS)** | `2 + 3 * (4 - 1) / 2`, `2^10`, `5!` |
| **Constants** | `pi`, `e`, `phi`, `tau`, `Infinity` |
| **Trigonometry** | `sin(pi/4)`, `cos(0)`, `tan(pi/3)`, `asin(0.5)`, `atan2(1,1)` |
| **Hyperbolic** | `sinh(1)`, `cosh(1)`, `tanh(0.5)` |
| **Logarithms** | `log(e)` (natural), `log10(1000)`, `log2(8)`, `log(100, 10)` |
| **Powers & roots** | `sqrt(144)`, `cbrt(27)`, `nthRoot(81, 4)`, `pow(2, 10)` |
| **Rounding** | `round(3.7)`, `ceil(3.2)`, `floor(3.8)`, `fix(3.7)` |
| **Statistics** | `mean([1,2,3])`, `median([1,2,3,4])`, `std([1,2,3])`, `variance([1,2,3])` |
| | `min([3,7,1])`, `max([3,7,1])`, `sum([1,2,3])`, `prod([1,2,3])` |
| **Combinatorics** | `factorial(5)`, `combinations(10,3)`, `permutations(10,3)` |
| **Modular** | `mod(17, 5)`, `gcd(12, 8)`, `lcm(4, 6)` |
| **Bitwise** | `bitAnd(5, 3)`, `bitOr(5, 3)`, `bitXor(5, 3)`, `leftShift(1, 3)` |
| **Complex numbers** | `complex(3, 4)`, `abs(complex(3,4))`, `arg(complex(3,4))` |
| **Unit conversion** | `5 inch to cm`, `100 fahrenheit to celsius` |
| **Matrix operations** | `det([[1,2],[3,4]])`, `inv([[1,2],[3,4]])`, `transpose([[1,2],[3,4]])` |
| **Variables** | `x = 5; y = 3; x^2 + y^2` (semicolon-separated, returns last result) |

### Security

- mathjs `import`, `createUnit`, `simplify`, and `derivative` functions are disabled to prevent abuse
- Expression length is capped at 2000 characters
- Runs entirely in-process (no external calls)

### Schema

```json
{
  "expression": "string (required) — mathjs expression",
  "precision": "integer (optional) — significant digits, default 14"
}
```

### Key files

- `api/app/clients/tools/structured/ScientificCalculator.js`
- `api/app/clients/tools/structured/specs/ScientificCalculator.spec.js`

---

## Code Interpreter Math

### What it does

Routes advanced mathematical computation to the locally hosted code interpreter (Python). Use this when the Scientific Calculator is insufficient — symbolic algebra, statistical tests, numerical methods, optimization, large matrix operations, etc.

### When to use it instead of the Scientific Calculator

- Symbolic algebra: solving equations, simplification, integration, differentiation (sympy)
- Statistical tests: t-test, chi-square, ANOVA, regression (scipy.stats)
- Numerical methods: optimization, root finding, interpolation, ODE solving (scipy)
- Probability distributions: PDF, CDF, sampling, confidence intervals
- Data transformations: FFT, convolutions, filtering (numpy)
- Any multi-step computation that benefits from variables and loops

### Available Python libraries

The local code interpreter environment has:
- `numpy`
- `scipy`
- `sympy`
- Python standard library (`math`, `statistics`, `itertools`, `fractions`, etc.)

### Schema

```json
{
  "code": "string (required) — Python code to execute. Print the result.",
  "description": "string (optional) — Brief description for logging."
}
```

### Configuration

The tool reads the code interpreter endpoint from environment variables (same ones used by the existing code interpreter integration):

- `LIBRECHAT_CODE_BASEURL` — default: `http://code-interpreter-local:8000/v1`
- `LIBRECHAT_CODE_API_KEY` — default: `librechat-local-code-dev-key`

No additional configuration is needed if the local code interpreter is already running.

### Graceful degradation

If the code interpreter service is down, the tool returns a friendly error suggesting the user fall back to the Scientific Calculator for basic math.

### Key files

- `api/app/clients/tools/structured/CodeInterpreterMath.js`
- `api/app/clients/tools/structured/specs/CodeInterpreterMath.spec.js`

---

## Tool selection guidance (for LLMs)

The tool descriptions are written so LLMs naturally route to the right tool:

1. **Scientific Calculator** — Use for any computation that needs an exact numeric answer and can be expressed as a single mathjs expression (or semicolon-separated expressions).
2. **Code Interpreter Math** — Use when the scientific calculator is insufficient: symbolic math, statistical tests, numerical methods, multi-step logic with loops/branches.
3. **Calculator** (upstream) — Still available for backward compatibility. The Scientific Calculator supersedes it with a richer schema.

---

## Registration

Both tools are registered in:

- `api/app/clients/tools/manifest.json` — plugin metadata for the UI
- `api/app/clients/tools/index.js` — module exports
- `api/app/clients/tools/util/handleTools.js` — runtime tool constructor map

They appear in the agent/plugin tool picker in the UI under "Scientific Calculator" and "Code Interpreter Math". No API keys or auth are required.

---

## Testing

```bash
cd api && npx jest --testPathPatterns="ScientificCalculator.spec|CodeInterpreterMath.spec" --no-coverage
```

Expected: 43 tests passing (36 for ScientificCalculator, 7 for CodeInterpreterMath).
