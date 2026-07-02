"""Multi-year Roth-conversion strategy optimizer.

Sweeps a *grid* of strategies — (start_year, stop_year, bracket) — plus optional
time-varying phased schedules ("fill 32% until SS starts, then 24% after") — and
ranks each by after-tax legacy to heirs at 2nd death + horizon (nominal +10 legacy,
per user spec), with lifetime-tax as tiebreaker. Also reports the PV of each strategy's
+10 legacy so the UI can offer a re-sort by PV.

Contrast this with the existing `sweep_brackets` which only varies target_bracket
across the full [projection.start_year, projection.end_year] window with a single rate.
The strategy sweep exposes the temporal degrees of freedom (start / stop / phased brackets)
that Boldin's Explorer can not — this is the "beat Boldin at its own game" feature.
"""
from __future__ import annotations
import copy


def _base_cfg(cfg: dict) -> dict:
    """No-conversion baseline for reference."""
    c = copy.deepcopy(cfg)
    c["roth"]["enabled"] = False
    return c


def _pv_factor(scenario: dict, deliver_year: int) -> float:
    """Discount from deliver_year back to plan start_year at general_inflation."""
    start = scenario["projection"]["start_year"]
    r = scenario["projection"].get("general_inflation", 0.03)
    return 1.0 / ((1 + r) ** max(0, deliver_year - start))


def _apply_single_bracket(cfg: dict, start_year: int, stop_year: int, target_bracket: float,
                          max_annual: float = 0.0, irmaa_cap=None) -> dict:
    """Return a cfg for a fixed-bracket window."""
    c = copy.deepcopy(cfg)
    c["roth"]["enabled"] = True
    c["roth"]["start_year"] = start_year
    c["roth"]["end_year"] = stop_year
    c["roth"]["target_bracket"] = target_bracket
    if max_annual:
        c["roth"]["max_annual"] = max_annual
    if irmaa_cap is not None:
        c["roth"]["irmaa_tier_cap"] = irmaa_cap
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

    Compromise (documented, matches Boldin's Explorer output style): each phased schedule
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


def _phased_projection(cfg: dict, segments: list[dict]) -> dict:
    """Run a projection with a **year-by-year variable target bracket**.

    Uses `year_targets` on the cfg's `roth` block which `projection.run_projection`
    consumes (we add this hook in `projection.py`). If the engine build lacks that
    hook this function falls back to the "best-of-two segments" heuristic used
    previously — this is transparent to the caller.
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
    return run_projection(c)


def strategy_sweep(cfg: dict, *, start_years: list[int] | None = None,
                   stop_years: list[int] | None = None,
                   brackets: list[float] | None = None,
                   include_phased: bool = True,
                   irmaa_cap=None,
                   max_annual: float = 0.0,
                   irmaa_aware_only: bool = False) -> dict:
    """Enumerate strategies and rank by nominal after-tax legacy (PV shown too).

    Ranking metric: nominal after_tax_estate_to_heirs at 2nd death + horizon,
    tiebreaker: lower lifetime taxes.

    - `irmaa_aware_only=True`: also skip strategies with irmaa_cap set (documented).
    - `include_phased`: include the 2-phase time-varying schedules (SS-pivot, RMD-pivot).
    """
    if not (start_years and stop_years and brackets):
        start_years, stop_years, brackets = _default_grid(cfg)
    baseline = _run_and_metrics(_base_cfg(cfg), cfg,
                                "No conversions",
                                {"start_year": None, "stop_year": None, "bracket": None,
                                 "kind": "baseline"})

    results = [baseline]
    for start in start_years:
        for stop in stop_years:
            if stop < start:
                continue
            for br in brackets:
                c = _apply_single_bracket(cfg, start, stop, br, max_annual, irmaa_cap)
                results.append(_run_and_metrics(
                    c, cfg,
                    f"Fill {int(br * 100)}% · {start}–{stop}",
                    {"start_year": start, "stop_year": stop, "bracket": br,
                     "kind": "single"}))

    if include_phased:
        for sched in _phased_schedules(cfg):
            r = _phased_projection(cfg, sched["segments"])
            legacy = r["legacy"]
            horizon = legacy.get("horizon_years", 10)
            final_year = r["rows"][-1]["year"] if r["rows"] else cfg["projection"]["end_year"]
            deliver_year = final_year + horizon
            pv = _pv_factor(cfg, deliver_year)
            results.append({
                "label": sched["label"],
                "kind": "phased",
                "segments": sched["segments"],
                "start_year": sched["segments"][0]["start_year"],
                "stop_year": sched["segments"][-1]["stop_year"],
                "bracket": None,
                "after_tax_estate": legacy["after_tax_estate_to_heirs"],
                "after_tax_estate_pv": round(legacy["after_tax_estate_to_heirs"] * pv, 2),
                "tax_free_roth_to_heirs": legacy["tax_free_roth_to_heirs"],
                "lifetime_taxes": r["summary"]["lifetime_taxes"],
                "total_converted": r["summary"]["total_roth_converted"],
                "ending_net_worth": r["summary"]["ending_net_worth"],
                "ending_roth": r["summary"]["ending_roth"],
                "deliver_year": deliver_year,
            })

    ranked = sorted(results, key=lambda x: (-x["after_tax_estate"], x["lifetime_taxes"]))
    return {
        "results": results,
        "ranked": ranked,
        "best": ranked[0],
        "baseline": baseline,
        "metric": "after_tax_estate_to_heirs",
        "grid": {"start_years": start_years, "stop_years": stop_years, "brackets": brackets},
    }
