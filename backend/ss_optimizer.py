"""Social Security claiming-age optimizer.

Sweeps client & spouse claim ages (62 / FRA / 70) using the SSA reduction /
delayed-retirement-credit formulas, mutates each SS income stream's amount +
start_date accordingly, then runs the full projection to rank by after-tax
legacy to heirs at 2nd death + horizon.

Reduction / DRC rules (SSA):
  - FRA (Full Retirement Age): 67 for anyone born 1960 or later. 66y10m for 1959,
    interpolating back to 66 for pre-1955 (we snap to nearest whole year for the sweep).
  - Early claim: benefit reduced 5/9 of 1% for each of first 36 months before FRA,
    then 5/12 of 1% for each month beyond that. At age 62 (60mo early) that's a
    30% haircut (36 * 5/9% + 24 * 5/12% = 20% + 10% = 30%).
  - Delayed claim: 8% simple per year after FRA up to age 70 (24% at 70 for post-1960 FRA-67).
"""
from __future__ import annotations
import copy
from dataclasses import dataclass


def full_retirement_age(birth_year: int) -> int:
    """SSA FRA snapped to a whole year (67 for 1960+, else 66)."""
    if birth_year >= 1960:
        return 67
    return 66


def _reduction_factor(fra: int, claim_age: int) -> float:
    """Multiplier applied to the FRA (PIA) benefit for claim at `claim_age`.
    Early = <1.0 (reduction), late = >1.0 (delayed credits), cap at 70."""
    if claim_age < 62:
        claim_age = 62
    if claim_age > 70:
        claim_age = 70
    if claim_age == fra:
        return 1.0
    if claim_age < fra:
        months_early = (fra - claim_age) * 12
        first = min(36, months_early)
        rest = max(0, months_early - 36)
        pct_off = first * (5 / 9 / 100) + rest * (5 / 12 / 100)
        return round(1.0 - pct_off, 4)
    # delayed retirement credits: 8% simple per year past FRA
    return round(1.0 + 0.08 * (claim_age - fra), 4)


# --- FRA benefit derivation from a stream row (inverse of the reduction factor) ---
def _implied_fra_amount(stream: dict, birth_year: int) -> float:
    """Given a stream's current `amount` (monthly) and its current `start_date` year,
    back out the FRA (PIA) monthly amount. This treats the user's existing entry as
    the benefit they'd get at whatever age they entered — so sweeping to a NEW age
    rescales relative to that FRA baseline."""
    fra = full_retirement_age(birth_year)
    current_claim_year = int(str(stream.get("start_date") or f"{stream.get('start_year')}-01-01")[:4])
    current_claim_age = current_claim_year - birth_year
    f = _reduction_factor(fra, current_claim_age)
    if f <= 0:
        return stream.get("amount", 0.0)
    return stream.get("amount", 0.0) / f


@dataclass
class ClaimSpec:
    owner: str            # "Client" | "Spouse"
    birth_year: int
    claim_age: int        # 62..70
    fra_amount: float     # implied monthly amount at FRA


def _apply_claim(scenario: dict, spec: ClaimSpec) -> None:
    """Mutate scenario in place: rescale + reslate the SS stream owned by `spec.owner`."""
    fra = full_retirement_age(spec.birth_year)
    factor = _reduction_factor(fra, spec.claim_age)
    new_amount = round(spec.fra_amount * factor, 2)
    new_start_year = spec.birth_year + spec.claim_age
    new_start_date = f"{new_start_year}-01-01"
    for s in scenario["income_streams"]:
        if s.get("tax_character") == "SS" and s.get("owner") == spec.owner:
            s["amount"] = new_amount
            s["start_date"] = new_start_date
            s["start_year"] = new_start_year
            s["stop_date"] = None
            s["stop_year"] = None
            s["use"] = True


def _current_claim_age(scenario: dict, owner: str, birth_year: int) -> int:
    """Read the current claim age from the scenario's SS stream (defaults to 67)."""
    for s in scenario["income_streams"]:
        if s.get("tax_character") == "SS" and s.get("owner") == owner:
            start = str(s.get("start_date") or f"{s.get('start_year') or (birth_year + 67)}-01-01")
            return int(start[:4]) - birth_year
    return full_retirement_age(birth_year)


def _extract_fra_amounts(scenario: dict) -> dict:
    """Compute each owner's implied FRA (PIA) monthly amount from their current stream."""
    h = scenario["household"]
    out = {}
    for owner, dob_key in (("Client", "client_dob_year"), ("Spouse", "spouse_dob_year")):
        by = h.get(dob_key)
        if by is None:
            continue
        for s in scenario["income_streams"]:
            if s.get("tax_character") == "SS" and s.get("owner") == owner:
                out[owner] = _implied_fra_amount(s, by)
                break
    return out


def sweep_ss_claims(cfg: dict, ages: list[int] | None = None) -> dict:
    """Enumerate (client_age, spouse_age) pairs in `ages`, run the projection for each,
    and rank by after-tax legacy to heirs at 2nd death + horizon.

    Returns:
      {
        "baseline": {client_age, spouse_age, ...metrics},
        "results": [ { ...metrics } ... ],
        "best": {best entry, mirrors metrics},
        "ranked": sorted by after_tax_estate descending,
        "fra_amounts": {"Client": ..., "Spouse": ...},
        "fra_ages": {"Client": 67, "Spouse": 67},
      }
    """
    # deferred import to avoid circular dependency at module load
    from projection import run_projection

    ages = ages or [62, 65, 67, 70]
    h = cfg["household"]
    client_by = h["client_dob_year"]
    has_spouse = h.get("spouse_dob_year") is not None
    spouse_by = h.get("spouse_dob_year")
    fra_amounts = _extract_fra_amounts(cfg)
    fra_ages = {"Client": full_retirement_age(client_by)}
    if has_spouse:
        fra_ages["Spouse"] = full_retirement_age(spouse_by)

    # baseline = current scenario as-is
    baseline_run = run_projection(cfg)
    baseline_metrics = {
        "client_age": _current_claim_age(cfg, "Client", client_by),
        "spouse_age": (_current_claim_age(cfg, "Spouse", spouse_by) if has_spouse else None),
        "label": "Current plan",
        "after_tax_estate": baseline_run["legacy"]["after_tax_estate_to_heirs"],
        "lifetime_taxes": baseline_run["summary"]["lifetime_taxes"],
        "lifetime_ss": round(sum(r["gross_ss"] for r in baseline_run["rows"]), 2),
        "ending_net_worth": baseline_run["summary"]["ending_net_worth"],
        "is_baseline": True,
    }

    results = []
    spouse_options = ages if has_spouse else [None]
    for ca in ages:
        for sa in spouse_options:
            c = copy.deepcopy(cfg)
            if "Client" in fra_amounts:
                _apply_claim(c, ClaimSpec("Client", client_by, ca, fra_amounts["Client"]))
            if has_spouse and sa is not None and "Spouse" in fra_amounts:
                _apply_claim(c, ClaimSpec("Spouse", spouse_by, sa, fra_amounts["Spouse"]))
            r = run_projection(c)
            results.append({
                "client_age": ca,
                "spouse_age": sa,
                "label": (f"Client {ca}, Spouse {sa}" if has_spouse else f"Client {ca}"),
                "after_tax_estate": r["legacy"]["after_tax_estate_to_heirs"],
                "lifetime_taxes": r["summary"]["lifetime_taxes"],
                "lifetime_ss": round(sum(row["gross_ss"] for row in r["rows"]), 2),
                "ending_net_worth": r["summary"]["ending_net_worth"],
                "is_baseline": False,
            })

    ranked = sorted(results, key=lambda x: (-x["after_tax_estate"], x["lifetime_taxes"]))
    return {
        "baseline": baseline_metrics,
        "results": results,
        "ranked": ranked,
        "best": ranked[0] if ranked else None,
        "fra_amounts": {k: round(v, 2) for k, v in fra_amounts.items()},
        "fra_ages": fra_ages,
    }
