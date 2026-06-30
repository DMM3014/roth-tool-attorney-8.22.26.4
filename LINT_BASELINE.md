# Project Lint & Quality Baseline

This file is the **source of truth** for what "clean" means in this repo. External /
third-party code-review linters are noisier than our toolchain and repeatedly flag
idiomatic, correct code. Before acting on any external report, check it against this baseline.

---

## How to verify the baseline (the only checks that count)

### Frontend — Create React App ESLint (`eslint-config-react-app` + `react-hooks`)
```bash
cd /app/frontend && yarn build      # or watch the dev-server output
```
**Baseline: 0 warnings, 0 errors.** This config already includes
`react-hooks/exhaustive-deps`. If the real build is clean, the hooks are correct.

### Backend — pytest + golden snapshot
```bash
cd /app/backend
export REACT_APP_BACKEND_URL=$(grep REACT_APP_BACKEND_URL ../frontend/.env | cut -d= -f2)
python -m pytest tests/ -q              # baseline: all pass (52+)
python tests/golden_snapshot.py check   # baseline: GOLDEN MATCH
```
`tests/test_golden_snapshot.py` runs this comparison in CI automatically, so any change
that alters a tax-engine / projection number to the cent fails the suite. If a tax change
is intentional, refresh with `python tests/golden_snapshot.py save` and review the diff.

---

## Known FALSE POSITIVES from external linters (do NOT "fix" these)

### 1. Python `is None` / `is not None` / `is True`
PEP 8 **requires** identity comparison against the `None` singleton (`x is None`, not
`x == None`). `is True` is an intentional exact-boolean check. Changing these to `==`
is a regression. Flagged at e.g. `projection.py` and `tax_engine.py` — all correct as-is.

### 2. React hook "missing dependencies" that are actually locals / module vars / setters
External tools frequently list a hook's *local variables* (loop indices `i`, destructured
`a`/`b`, computed `row`/`net_worth`/`ending`), *module-level* values (`listeners`), or
*stable* `useState` setters (`setState`, `setScenario`, `setMcResult`) as "missing deps."
The real `react-hooks/exhaustive-deps` rule does **not** require any of these, which is why
`yarn build` is clean. Adding them would break the code (locals) or cause render loops
(unstable objects). `src/hooks/use-toast.js` is the unmodified canonical shadcn implementation.

### 3. "Console statements in production code"
There are **none** in `frontend/src`. Verify: `grep -rn "console\." frontend/src`.

---

## Intentional `eslint-disable react-hooks/exhaustive-deps` (legitimate, keep them)

These mount-once / signature-debounced effects intentionally omit deps to avoid infinite
re-runs; they recompute via an explicit `JSON.stringify(...)` signature where needed:

- `Scenarios.jsx` — mount `refresh()` effect; debounced projection effect keyed on `sig`.
- `Compare.jsx` / `DetailCashflow.jsx` — debounced projection effects keyed on a config `sig`.
- `Planner.jsx` — `setMcResult(null)` invalidation keyed on the scenario signature.

---

## Maintainability conventions actually applied here
- Validated tax math lives in small, single-purpose functions guarded by the golden snapshot;
  config is passed via the `Plan` dataclass (and `YearStatus` / `YearCalc` / `YearFlows` /
  `_HeirSleeves` param objects) to keep argument counts low.
- The AI-summary derivation lives in `src/hooks/useAiSummary.js`; large tabs are split into
  presentational sub-components (e.g. `ProjectionPanels.jsx`).
- Recharts config literals (margins/domains/ticks) are intentionally left inline — hoisting
  them yields no measurable benefit versus Recharts' own re-render cost and only adds noise.
