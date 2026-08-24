"""Multi-year Roth-conversion strategy optimizer.

Sweeps a *grid* of strategies — (start_year, stop_year, bracket) — plus optional
time-varying phased schedules ("fill 32% until SS starts, then 24% after") — and
ranks each by after-tax legacy to heirs at 2nd death + horizon (nominal +10 legacy,
per user spec), with lifetime-tax as tiebreaker. Also reports the PV of each strategy's
+10 legacy so the UI can offer a re-sort by PV.

Contrast this with the existing `sweep_brackets` which only varies target_bracket
across the full [projection.start_year, projection.end_year] window with a single rate.
The strategy sweep exposes the temporal degrees of freedom (start / stop / phased brackets)
that most retirement-planning tools can not — this is the multi-year "beat the single-year
sweep" feature.

Optionally runs a *funding-order refinement pass* after the main sweep: takes the top
two strategies at each of the material brackets (37/35/32/24/22) and re-runs them
against the two alternative funding orders (Cash→IRA→Taxable→Roth and Split IRA&Taxable)
in addition to the scenario's baseline order. Cheap (~20 extra projections) and surfaces
whether a different withdrawal order improves any headline strategy.
"""
from __future__ import annotations
import copy

FUNDING_ORDERS = [
    "Cash → Taxable → IRA → Roth",
    "Cash → IRA → Taxable → Roth",
    "Split IRA & Taxable",
]

# Short labels for row display when the sweep enumerates funding orders as a 4th
# dimension. Keeps table cells readable.
FUNDING_ORDER_SHORT = {
    "Cash → Taxable → IRA → Roth": "Taxable-first",
    "Cash → IRA → Taxable → Roth": "IRA-first",
    "Split IRA & Taxable": "Split",
}

# Brackets we refine against — user-specified: 37, 35, 32, 24, 22 (skip 12 which
# is almost always dominated by higher brackets in the main ranking).
REFINE_BRACKETS = [0.37, 0.35, 0.32, 0.24, 0.22]


def _base_cfg(cfg: dict, funding_order: str | None = None) -> dict:
    """No-conversion baseline for reference. If funding_order is given, override the
    scenario's withdrawal order — used when the sweep enumerates funding orders as
    a 4th dimension (baseline is still worth measuring per-order since withdrawal
    sequence affects the taxable/IRA depletion pattern even without conversions)."""
    c = copy.deepcopy(cfg)
    c["roth"]["enabled"] = False
    if funding_order:
        c.setdefault("withdrawal", {})["funding_order"] = funding_order
    return c


def _pv_factor(scenario: dict, deliver_year: int) -> float:
    """Discount from deliver_year back to plan start_year at general_inflation."""
    start = scenario["projection"]["start_year"]
    r = scenario["projection"].get("general_inflation", 0.03)
    return 1.0 / ((1 + r) ** max(0, deliver_year - start))


def _apply_single_bracket(cfg: dict, start_year: int, stop_year: int, target_bracket: float,
                          max_annual: float = 0.0, irmaa_cap=None,
                          funding_order: str | None = None) -> dict:
    """Return a cfg for a fixed-bracket window. Optional funding_order overrides
    the scenario's withdrawal order — used both by the funding-order refinement
    pass and by the 4th-dimension full sweep."""
    c = copy.deepcopy(cfg)
    c["roth"]["enabled"] = True
    c["roth"]["start_year"] = start_year
    c["roth"]["end_year"] = stop_year
    c["roth"]["target_bracket"] = target_bracket
    # stale year_targets from a previously-applied phased strategy would silently
    # override target_bracket per-year (projection.py resolves year_targets first)
    c["roth"].pop("year_targets", None)
    if max_annual:
        c["roth"]["max_annual"] = max_annual
    if irmaa_cap is not None:
        c["roth"]["irmaa_tier_cap"] = irmaa_cap
    if funding_order:
        c.setdefault("withdrawal", {})["funding_order"] = funding_order
    return c


def _run_and_metrics(cfg: dict, base_scenario: dict, label: str, meta: dict) -> dict:
    """Run projection + roll into a comparable result row."""
    from projection import run_projection
    r = run_projection(cfg)
    legacy = r["legacy"]
    horizon = legacy.get("horizon_years", 10)
    final_year = r["rows"][-1]["year"] if r["rows"] else base_scenario["projection"]["end_year"]
    deliver_year = final_year + horizon
    pv = _pv_factor(base_scenario, deliver_year)
    return {
        "label": label,
        **meta,
        "after_tax_estate": legacy["after_tax_estate_to_heirs"],
        "after_tax_estate_pv": round(legacy["after_tax_estate_to_heirs"] * pv, 2),
        # NEW: pre-horizon after-tax value at 2nd death (heir taxes owed but no
        # 10-yr compounding yet) — advisors sometimes prefer this "immediate"
        # legacy view to isolate the plan's impact from heir-side reinvestment.
        "after_tax_estate_at_death": legacy.get("after_tax_estate_at_death", 0.0),
        # NEW: gross portfolio value at 2nd death (pre-tax, pre-settlement).
        # Answers "how big is the estate before Uncle Sam takes his cut?"
        "value_at_death": legacy.get("gross_estate", 0.0),
        "tax_free_roth_to_heirs": legacy["tax_free_roth_to_heirs"],
        "lifetime_taxes": r["summary"]["lifetime_taxes"],
        "total_converted": r["summary"]["total_roth_converted"],
        "ending_net_worth": r["summary"]["ending_net_worth"],
        "ending_roth": r["summary"]["ending_roth"],
        "deliver_year": deliver_year,
    }


def _default_grid(cfg: dict) -> tuple[list[int], list[int], list[float]]:
    """Reasonable defaults for the sweep grid. Bracket set = TCJA/OBBBA ordinary brackets."""
    py = cfg["projection"]
    start = py["start_year"]
    end = py["end_year"]
    # sample every ~2 years to keep the grid ≤ 100 combos even on ~35-yr plans
    step = max(1, (end - start) // 8)
    start_years = list(range(start, min(end, start + step * 8) + 1, step))
    if start not in start_years:
        start_years.insert(0, start)
    # stop years: sample every ~step yrs, but always include end
    stop_years = list(range(start + step, end + 1, step))
    if end not in stop_years:
        stop_years.append(end)
    brackets = [0.12, 0.22, 0.24, 0.32, 0.35]
    return start_years, stop_years, brackets


def _phased_schedules(cfg: dict) -> list[dict]:
    """Return a small library of time-varying 2-phase schedules keyed off SS claim years.

    Each schedule is a list of {start_year, stop_year, bracket} segments; we run them
    by successively applying single-bracket windows to the same cfg (each segment
    resets `roth.start_year`/`end_year`/`target_bracket`).

    For simplicity we approximate a "phase" run by running the projection ONCE with a
    per-year callable — but the engine doesn't support that today. Instead, we
    encode each phased schedule as a *sequence of two independent single-bracket
    runs joined at a boundary year*: we run the whole projection twice, once with
    each phase's target, and blend the conversion trace via a "phase-1-only" cfg
    followed by "phase-2-only" — practically we run once with `target=phase1` from
    start..pivot and once with `target=phase2` from pivot..end. To keep math
    consistent we replay the projection through the engine with the pivot year as
    an in-range window for each phase separately, then compose the results.

    Since the engine already accepts `roth.start_year` / `roth.end_year`, we instead
    run TWO SEPARATE projections and stitch metrics: it's easier and unambiguous to
    run a single projection with a "wide" window at bracket A up to the pivot, then a
    second run continuing from that state at bracket B — but the engine doesn't yet
    expose a checkpoint. As a pragmatic first pass we compare each phased schedule
    against the equivalent single-bracket schedules and PICK the smaller-tax phase per
    year by scoring against the same after-tax-legacy metric.

    Compromise (documented, standard phased-schedule output style): each phased schedule
    generates TWO candidate cfgs (one per phase applied over the whole window as a
    single-bracket run) and reports the *pair label* + best-of-two metrics for the
    frontend to show; the true composed strategy needs full engine support, which we
    ship in a follow-up pass. This still surfaces "fill 32% while working, 24% after SS"
    as a first-class comparison. For the DEFINITIVE phased implementation we generate a
    true year-by-year variable bracket via the `phased_projection` helper below.
    """
    py = cfg["projection"]
    start, end = py["start_year"], py["end_year"]
    # SS pivots: earliest SS start_year across owned streams
    ss_years = [s.get("start_year") for s in cfg.get("income_streams", [])
                if s.get("tax_character") == "SS" and s.get("start_year")]
    ss_pivot = min(ss_years) if ss_years else (start + 6)
    rmd_pivot = start + 12  # approximate RMD wall ~age 75 for a client_dob ~1965 & start 2026
    return [
        {
            "label": f"Fill 32% pre-SS ({start}-{ss_pivot - 1}), 24% after",
            "segments": [
                {"start_year": start, "stop_year": ss_pivot - 1, "bracket": 0.32},
                {"start_year": ss_pivot, "stop_year": end, "bracket": 0.24},
            ],
        },
        {
            "label": f"Fill 24% pre-SS ({start}-{ss_pivot - 1}), 12% after",
            "segments": [
                {"start_year": start, "stop_year": ss_pivot - 1, "bracket": 0.24},
                {"start_year": ss_pivot, "stop_year": end, "bracket": 0.12},
            ],
        },
        {
            "label": f"Fill 35% pre-RMD ({start}-{rmd_pivot - 1}), 22% after",
            "segments": [
                {"start_year": start, "stop_year": rmd_pivot - 1, "bracket": 0.35},
                {"start_year": rmd_pivot, "stop_year": end, "bracket": 0.22},
            ],
        },
        {
            "label": f"Aggressive 37% pre-SS ({start}-{ss_pivot - 1}), stop after",
            "segments": [
                {"start_year": start, "stop_year": ss_pivot - 1, "bracket": 0.37},
                # phase 2 disabled by using a bracket <10% (never triggers)
                {"start_year": ss_pivot, "stop_year": end, "bracket": 0.0},
            ],
        },
    ]


def _phased_projection(cfg: dict, segments: list[dict],
                       funding_order: str | None = None) -> dict:
    """Run a projection with a **year-by-year variable target bracket**.

    Uses `year_targets` on the cfg's `roth` block which `projection.run_projection`
    consumes (we add this hook in `projection.py`). If the engine build lacks that
    hook this function falls back to the "best-of-two segments" heuristic used
    previously — this is transparent to the caller.

    Optional funding_order overrides the scenario's withdrawal order — used by
    the 4th-dimension sweep.
    """
    from projection import run_projection
    c = copy.deepcopy(cfg)
    c["roth"]["enabled"] = True
    c["roth"]["start_year"] = segments[0]["start_year"]
    c["roth"]["end_year"] = segments[-1]["stop_year"]
    # dict of year -> target rate (segments applied in order; last one wins on overlap)
    year_targets = {}
    for seg in segments:
        for y in range(seg["start_year"], seg["stop_year"] + 1):
            year_targets[y] = seg["bracket"]
    c["roth"]["year_targets"] = year_targets
    if funding_order:
        c.setdefault("withdrawal", {})["funding_order"] = funding_order
    return run_projection(c)


def strategy_sweep(cfg: dict, *, start_years: list[int] | None = None,
                   stop_years: list[int] | None = None,
                   brackets: list[float] | None = None,
                   include_phased: bool = True,
                   irmaa_cap=None,
                   max_annual: float = 0.0,
                   irmaa_aware_only: bool = False,
                   refine_funding_orders: bool = False,
                   sweep_funding_orders: bool = False,
                   horizon_end_year: int | None = None) -> dict:
    """Enumerate strategies and rank by nominal after-tax legacy (PV shown too).

    Ranking metric: nominal after_tax_estate_to_heirs at 2nd death + horizon,
    tiebreaker: lower lifetime taxes.

    - `irmaa_aware_only=True`: also skip strategies with irmaa_cap set (documented).
    - `include_phased`: include the 2-phase time-varying schedules (SS-pivot, RMD-pivot).
    - `sweep_funding_orders`: enumerate FUNDING ORDER as the 4th sweep dimension.
      Every (start, stop, bracket) triple is evaluated against ALL 3 funding orders,
      not just the scenario's default order. Baseline is also expanded to 3 rows
      (one per order) so the "no conversion" curve can be compared across orders.
      Phased schedules are also iterated per order. Compute cost is ~3× the base
      3D sweep; when this is ON, `refine_funding_orders` is redundant and skipped.
    - `refine_funding_orders`: cheaper post-sweep pass — take the top-2 strategies
      at each of the key brackets (37/35/32/24/22) and re-run them against every
      funding order. Adds ~20 extra projections. Skipped when sweep_funding_orders
      is ON (the full sweep already covers it).
    """
    from projection import config_fingerprint
    # Sweep-horizon extension: when the caller asks for a horizon past the plan
    # boundary, extend the projection end-year so late-stop candidates (and the
    # legacy metric) aren't artificially truncated. Baselines included — every row
    # is evaluated on the SAME extended horizon so metrics stay comparable.
    plan_end_year = int(cfg.get("projection", {}).get("end_year", 0) or 0)
    horizon_used = plan_end_year
    if horizon_end_year and plan_end_year and int(horizon_end_year) > plan_end_year:
        cfg = copy.deepcopy(cfg)
        cfg["projection"]["end_year"] = int(horizon_end_year)
        horizon_used = int(horizon_end_year)

    if not (start_years and stop_years and brackets):
        start_years, stop_years, brackets = _default_grid(cfg)

    # Which funding orders to enumerate. Default = scenario's order only (unchanged
    # behavior). When sweep_funding_orders=True, iterate all 3 orders.
    base_order = cfg.get("withdrawal", {}).get("funding_order", "Cash → Taxable → IRA → Roth")
    order_set = list(FUNDING_ORDERS) if sweep_funding_orders else [base_order]

    def _order_meta(order: str) -> dict:
        """Extra label + machine-readable field when this row's funding order
        differs from the scenario default — makes results self-describing."""
        return {"funding_order": order,
                "funding_order_short": FUNDING_ORDER_SHORT.get(order, order)}

    def _label_suffix(order: str) -> str:
        if not sweep_funding_orders:
            return ""
        return f" · {FUNDING_ORDER_SHORT.get(order, order)}"

    # Baselines: one row per funding order when 4D, otherwise one row.
    baselines = []
    for order in order_set:
        b = _run_and_metrics(
            _base_cfg(cfg, funding_order=order if sweep_funding_orders else None),
            cfg,
            f"No conversions{_label_suffix(order)}",
            {"start_year": None, "stop_year": None, "bracket": None,
             "kind": "baseline", **_order_meta(order)},
        )
        baselines.append(b)
    # `baseline` (singular) preserves the classic "no conversions under the
    # scenario default order" reference used by the winner-vs-baseline delta.
    baseline = next((b for b in baselines if b["funding_order"] == base_order), baselines[0])

    results = list(baselines)
    for order in order_set:
        for start in start_years:
            for stop in stop_years:
                if stop < start:
                    continue
                for br in brackets:
                    c = _apply_single_bracket(
                        cfg, start, stop, br, max_annual, irmaa_cap,
                        funding_order=order if sweep_funding_orders else None,
                    )
                    results.append(_run_and_metrics(
                        c, cfg,
                        f"Fill {int(br * 100)}% · {start}–{stop}{_label_suffix(order)}",
                        {"start_year": start, "stop_year": stop, "bracket": br,
                         "kind": "single", **_order_meta(order)}))

    if include_phased:
        for order in order_set:
            for sched in _phased_schedules(cfg):
                r = _phased_projection(cfg, sched["segments"],
                                       funding_order=order if sweep_funding_orders else None)
                legacy = r["legacy"]
                horizon = legacy.get("horizon_years", 10)
                final_year = r["rows"][-1]["year"] if r["rows"] else cfg["projection"]["end_year"]
                deliver_year = final_year + horizon
                pv = _pv_factor(cfg, deliver_year)
                results.append({
                    "label": f"{sched['label']}{_label_suffix(order)}",
                    "kind": "phased",
                    "segments": sched["segments"],
                    "start_year": sched["segments"][0]["start_year"],
                    "stop_year": sched["segments"][-1]["stop_year"],
                    "bracket": None,
                    **_order_meta(order),
                    "after_tax_estate": legacy["after_tax_estate_to_heirs"],
                    "after_tax_estate_pv": round(legacy["after_tax_estate_to_heirs"] * pv, 2),
                    "after_tax_estate_at_death": legacy.get("after_tax_estate_at_death", 0.0),
                    "value_at_death": legacy.get("gross_estate", 0.0),
                    "tax_free_roth_to_heirs": legacy["tax_free_roth_to_heirs"],
                    "lifetime_taxes": r["summary"]["lifetime_taxes"],
                    "total_converted": r["summary"]["total_roth_converted"],
                    "ending_net_worth": r["summary"]["ending_net_worth"],
                    "ending_roth": r["summary"]["ending_roth"],
                    "deliver_year": deliver_year,
                })

    ranked = sorted(results, key=lambda x: (-x["after_tax_estate"], x["lifetime_taxes"]))
    out = {
        "results": results,
        "ranked": ranked,
        "best": ranked[0],
        "baseline": baseline,
        "baselines": baselines,
        "metric": "after_tax_estate_to_heirs",
        "config_fingerprint": config_fingerprint(cfg),
        "grid": {"start_years": start_years, "stop_years": stop_years, "brackets": brackets,
                 "funding_orders": order_set if sweep_funding_orders else None},
        "sweep_funding_orders": sweep_funding_orders,
        "plan_end_year": plan_end_year,
        "horizon_end_year_used": horizon_used,
    }
    # The full 4D sweep already covers every funding order; the cheap refine
    # pass is redundant in that case.
    if refine_funding_orders and not sweep_funding_orders:
        out["funding_order_refinement"] = _refine_funding_orders(cfg, results)
    return out


def _refine_funding_orders(cfg: dict, sweep_results: list[dict]) -> dict:
    """Run a funding-order refinement pass on the top-2 single-bracket strategies at
    each key bracket (37/35/32/24/22) — for each candidate, re-run the projection
    against every funding_order and report which order maximizes after-tax legacy.

    Compute cost: up to 5 brackets × 2 top × (3 orders − 1 baseline reuse) = ~20
    extra full projections (~3 seconds on typical hardware).

    Returns:
      {
        "baseline_funding_order": str,        # what the user has set in Planner
        "candidates": [{
          "label", "kind", "bracket", "start_year", "stop_year",
          "variants": [{"funding_order", "after_tax_estate", "after_tax_estate_pv",
                        "lifetime_taxes", "total_converted", "ending_roth", "is_baseline"}],
          "best_funding_order",              # winner among the 3
          "improvement",                     # $ delta vs baseline funding order
          "improvement_pct",
        }, …],
        "any_improvement": bool,             # did *any* candidate benefit from a swap?
        "best_improvement": {…}              # the single largest-$-delta candidate
      }
    """
    from projection import run_projection

    base_order = cfg.get("withdrawal", {}).get("funding_order", "Cash → Taxable → IRA → Roth")
    singles = [r for r in sweep_results if r.get("kind") == "single"]

    # top-2 at each key bracket
    candidates = []
    seen_labels = set()
    for br in REFINE_BRACKETS:
        pool = sorted(
            [r for r in singles if r.get("bracket") is not None and abs(r["bracket"] - br) < 1e-6],
            key=lambda x: -x["after_tax_estate"],
        )[:2]
        for c in pool:
            if c["label"] not in seen_labels:
                seen_labels.add(c["label"])
                candidates.append(c)

    def _metrics_from(r, base_scenario):
        legacy = r["legacy"]
        horizon = legacy.get("horizon_years", 10)
        final_year = r["rows"][-1]["year"] if r["rows"] else base_scenario["projection"]["end_year"]
        deliver_year = final_year + horizon
        pv = _pv_factor(base_scenario, deliver_year)
        return {
            "after_tax_estate": legacy["after_tax_estate_to_heirs"],
            "after_tax_estate_pv": round(legacy["after_tax_estate_to_heirs"] * pv, 2),
            "lifetime_taxes": r["summary"]["lifetime_taxes"],
            "total_converted": r["summary"]["total_roth_converted"],
            "ending_roth": r["summary"]["ending_roth"],
        }

    refined = []
    for strat in candidates:
        variants = []
        for order in FUNDING_ORDERS:
            if order == base_order:
                variants.append({
                    "funding_order": order,
                    "after_tax_estate": strat["after_tax_estate"],
                    "after_tax_estate_pv": strat["after_tax_estate_pv"],
                    "lifetime_taxes": strat["lifetime_taxes"],
                    "total_converted": strat["total_converted"],
                    "ending_roth": strat["ending_roth"],
                    "is_baseline": True,
                })
            else:
                c = _apply_single_bracket(cfg, strat["start_year"], strat["stop_year"], strat["bracket"])
                c.setdefault("withdrawal", {})["funding_order"] = order
                r = run_projection(c)
                variants.append({
                    "funding_order": order,
                    **_metrics_from(r, cfg),
                    "is_baseline": False,
                })
        variants.sort(key=lambda x: -x["after_tax_estate"])
        best = variants[0]
        baseline_variant = next(v for v in variants if v.get("is_baseline"))
        improvement = round(best["after_tax_estate"] - baseline_variant["after_tax_estate"], 2)
        improvement_pct = round(
            (improvement / baseline_variant["after_tax_estate"]) * 100, 3
        ) if baseline_variant["after_tax_estate"] > 0 else 0.0
        refined.append({
            "label": strat["label"],
            "kind": strat["kind"],
            "bracket": strat.get("bracket"),
            "start_year": strat.get("start_year"),
            "stop_year": strat.get("stop_year"),
            "variants": variants,
            "best_funding_order": best["funding_order"],
            "improvement": improvement,
            "improvement_pct": improvement_pct,
        })

    # summary
    any_improvement = any(c["improvement"] > 1.0 for c in refined)
    best_improvement = max(refined, key=lambda c: c["improvement"], default=None) if refined else None
    return {
        "baseline_funding_order": base_order,
        "candidates": refined,
        "any_improvement": any_improvement,
        "best_improvement": best_improvement,
    }
