"""Multi-year retirement projection engine.

Year-by-year simulation built on top of tax_engine.compute_year_tax, mirroring
the spreadsheet's CashFlow/Accounts/RMD/Income/Tax circular relationship
(taxes -> withdrawals -> taxable income -> taxes), resolved by iteration.
"""
from __future__ import annotations
import copy
import logging
from dataclasses import dataclass, field

from law_constants import LAW
_QCD_CAP_DEFAULT = LAW["figures"]["qcd_cap"]["value"]
from datetime import date
from typing import Any

from tax_engine import (compute_year_tax, optimize_conversion, rmd_divisor,
                        rmd_start_age, bracket_ceiling, irmaa_threshold_cap,
                        bracket_fill, irmaa_thresholds, ltcg_band_split)
from market_scenarios import apply_market_scenario

IRMAA_LOOKBACK_YEARS = 2  # IRMAA surcharge is based on MAGI from 2 years prior (hard-coded SSA rule)


def _parse_date(v):
    """Parse an ISO date string (or datetime) into a date, else None."""
    if not v:
        return None
    if isinstance(v, date):
        return v
    s = str(v).strip()[:10]
    try:
        y, m, d = s.split("-")
        return date(int(y), int(m), int(d))
    except (ValueError, AttributeError):
        return None


def _days_in_year(year: int) -> int:
    return 366 if (year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)) else 365


def _active_fraction(start_d, stop_d, year: int) -> float:
    """Fraction of `year` that the [start_d, stop_d] window is active (inclusive
    both ends, matching the source spreadsheet's day-count proration)."""
    jan1 = date(year, 1, 1)
    dec31 = date(year, 12, 31)
    lo = max(start_d, jan1) if start_d else jan1
    hi = min(stop_d, dec31) if stop_d else dec31
    if hi < lo:
        return 0.0
    days = (hi - lo).days + 1  # inclusive
    return days / _days_in_year(year)


def _age(dob_year: int, year: int) -> int:
    return year - dob_year


def _normalize_state_move(move) -> dict | None:
    """Coerce a scenario.tax.state_move dict into `{year: int, from: str, to: str}` or None.

    Advisors can declare a single mid-plan state change (e.g. NY→FL at retirement).
    The projection swaps `state_code` in the tax computation for any year >= move.year.
    Returns None when the move is missing / malformed / a no-op.
    """
    if not isinstance(move, dict):
        return None
    yr = move.get("year")
    to = (move.get("to") or "").strip().upper()
    frm = (move.get("from") or "").strip().upper()
    if not yr or not isinstance(yr, int) or not to or to == frm:
        return None
    return {"year": int(yr), "from": frm, "to": to}


def _effective_state_code(plan_state_code: str, state_move, year: int) -> str:
    """The active state_code in `year`, honoring an optional mid-plan move."""
    if not state_move:
        return plan_state_code
    if year >= state_move["year"]:
        return state_move["to"]
    return state_move["from"] or plan_state_code


def _alive(dob_year: int, death_age: int, year: int) -> bool:
    return _age(dob_year, year) <= death_age


def _stream_amount(s: dict, year: int, both_alive: bool, survivor_owner: str | None) -> tuple[float, str]:
    """Annual amount for an income stream in `year`, returns (amount, tax_character).

    If start_date/stop_date are provided, the boundary years are prorated by the
    active day-count fraction (mirrors the spreadsheet); otherwise start_year/stop_year
    define full-year activity. COLA compounds from the stream's start year.
    """
    char = s.get("tax_character", "Ordinary")
    if not s.get("use", True):
        return 0.0, char

    sd = _parse_date(s.get("start_date"))
    ed = _parse_date(s.get("stop_date"))
    start_year = sd.year if sd else s.get("start_year", 2026)

    if sd or ed:
        frac = _active_fraction(sd, ed, year)
        if frac <= 0:
            return 0.0, char
    else:
        stop = s.get("stop_year")
        if year < start_year or (stop and year > stop):
            return 0.0, char
        frac = 1.0

    base = s.get("amount", 0.0)
    freq = 12 if s.get("frequency", "Annual") == "Monthly" else 1
    annual = base * freq
    cola = s.get("cola", 0.0)
    annual *= (1 + cola) ** max(0, year - start_year)
    annual *= frac

    # survivor handling: if owner has died, apply survivor %
    if not both_alive and survivor_owner is not None:
        owner = s.get("owner", "Joint")
        if owner != "Joint" and owner != survivor_owner:
            annual *= s.get("survivor_pct", 0.0)
    return annual, char


def _income_from_stream(s, year, client_alive, spouse_alive, both_alive, has_spouse, survivor_owner):
    """Classify one income stream into (ordinary_non_ss, gross_ss, recurring_div, pension) for a year.

    `pension` is a same-taxable subset of ordinary income (pensions + annuities) that
    some states exempt from state income tax. It is ALREADY included in ordinary_non_ss —
    the pension field is emitted separately purely for downstream state-tax exclusion math.
    """
    owner = s.get("owner", "Joint")
    owner_alive = (owner == "Joint" or (owner == "Client" and client_alive)
                   or (owner == "Spouse" and spouse_alive))
    if not owner_alive and s.get("tax_character") != "SS" and owner != "Joint":
        return 0.0, 0.0, 0.0, 0.0
    amt, char = _stream_amount(s, year, both_alive, survivor_owner)
    if char == "SS":
        # after first death, only the surviving owner's own SS benefit continues
        if not both_alive and has_spouse and not (
                (owner == "Client" and client_alive) or (owner == "Spouse" and spouse_alive)):
            return 0.0, 0.0, 0.0, 0.0
        return 0.0, amt, 0.0, 0.0
    if char == "QDiv/LTCG":
        return 0.0, 0.0, amt, 0.0
    if char == "Annuity":
        taxable = amt * s.get("taxable_pct", 1.0)
        # Annuities count as pension-like for state exclusion (most states treat them together).
        return taxable, 0.0, 0.0, taxable
    # Detect pension by type/description.
    stype = (s.get("type") or "").strip().lower()
    desc = (s.get("description") or s.get("name") or "").strip().lower()
    is_pension = ("pension" in stype) or ("pension" in desc)
    return amt, 0.0, 0.0, (amt if is_pension else 0.0)


def _aggregate_income(streams, year, client_alive, spouse_alive, both_alive, has_spouse, survivor_owner):
    """Sum income streams into (ordinary_non_ss, gross_ss, recurring_div, pension) for a year."""
    ordinary_non_ss = gross_ss = recurring_div = pension = 0.0
    for s in streams:
        o, ss, d, p = _income_from_stream(s, year, client_alive, spouse_alive,
                                          both_alive, has_spouse, survivor_owner)
        ordinary_non_ss += o
        gross_ss += ss
        recurring_div += d
        pension += p

    # survivor SS = higher of the two benefits (SSA widow(er) rule: the survivor
    # steps up to the deceased spouse's benefit when it exceeds their own).
    if not both_alive and has_spouse:
        ss_vals = [_stream_amount(s, year, True, None)[0]
                   for s in streams if s.get("tax_character") == "SS"]
        if ss_vals:
            gross_ss = max([gross_ss] + ss_vals)
    return ordinary_non_ss, gross_ss, recurring_div, pension


def _income_line_items(streams, year, client_alive, spouse_alive, both_alive,
                       has_spouse, survivor_owner):
    """Per-stream breakdown for the Cashflow tab.

    Returns a list of {source, owner, kind, amount, tax_character} where `kind` is a
    coarse cash-flow category (`wages`, `pension`, `annuity`, `ss`, `dividends`, `other`)
    so the frontend can bucket by section without re-parsing tax_character strings.
    ZERO amount rows are dropped so the tab doesn't render empty lines for streams
    that are dormant this year.
    """
    out = []
    for s in streams:
        o, ss, d, _p = _income_from_stream(s, year, client_alive, spouse_alive,
                                           both_alive, has_spouse, survivor_owner)
        amt = o + ss + d
        if amt <= 0:
            continue
        char = s.get("tax_character", "Ordinary")
        # Coarse-grained cash-flow bucket (independent of tax character):
        # Fallback label chain: explicit `description` (canonical stream field
        # per defaults.py + PlanInputs) → `name` (legacy / auto-generated
        # streams) → `category` → tax_character-based generic. Reading only
        # `name` caused every unnamed Ordinary stream owned by the same person
        # to collapse into a single "Wages / other ordinary — Client" row,
        # merging Wages + Pension totals — see cashflow-tab bug 2026-07-23.
        raw = (s.get("description") or s.get("name") or s.get("category") or "").strip()
        owner = s.get("owner", "Joint")
        if not raw:
            if char == "SS":
                raw = f"Social Security — {owner}"
            elif char == "QDiv/LTCG":
                raw = "Qualified dividends"
            elif char == "Annuity":
                raw = f"Annuity — {owner}"
            else:
                raw = f"Wages / other ordinary — {owner}"
        name = raw
        low = name.lower()
        if char == "SS":
            kind = "ss"
        elif char == "QDiv/LTCG":
            kind = "dividends"
        elif char == "Annuity":
            kind = "annuity"
        elif "pension" in low:
            kind = "pension"
        elif "wage" in low or "salary" in low or "w-2" in low or "w2" in low:
            kind = "wages"
        else:
            kind = "other"
        out.append({
            "source": name,
            "owner": s.get("owner", "Joint"),
            "kind": kind,
            "tax_character": char,
            "amount": round(amt, 2),
        })
    # SSA widow(er) step-up: keep the line items in sync with _aggregate_income's
    # "survivor SS = higher of the two benefits" rule via a synthetic delta row.
    if not both_alive and has_spouse:
        own_ss = sum(i["amount"] for i in out if i["tax_character"] == "SS")
        ss_vals = [_stream_amount(s, year, True, None)[0]
                   for s in streams if s.get("tax_character") == "SS"]
        best = max(ss_vals) if ss_vals else 0.0
        if best > own_ss + 0.005:
            out.append({
                "source": "Survivor benefit step-up (higher SS benefit)",
                "owner": survivor_owner or "Joint",
                "kind": "ss",
                "tax_character": "SS",
                "amount": round(best - own_ss, 2),
            })
    return out


def _total_rmd(plan, status, owner_map, bal, year):
    """Per-account Required Minimum Distributions across tax-deferred accounts.

    Returns (total, {account_id: rmd}). `owner_map` gives the CURRENT owner of each
    account (reassigned by spousal rollover at first death). RMD start age follows
    SECURE 2.0 by birth year; each account's RMD is taken from THAT account.
    """
    rmd_by = {}
    rmd_total = 0.0
    for aid in plan.ira_ids:
        owner = owner_map.get(aid, "Client")
        owner_alive = (owner == "Client" and status.client_alive) or (owner == "Spouse" and status.spouse_alive)
        rmd_by[aid] = 0.0
        if not owner_alive:
            continue
        dob = plan.client_dob if owner == "Client" else (plan.spouse_dob if plan.has_spouse else plan.client_dob)
        age = _age(dob, year)
        if age < rmd_start_age(dob):
            continue
        div = rmd_divisor(age)
        if div > 0 and bal[aid] > 0:
            rmd_by[aid] = bal[aid] / div
            rmd_total += rmd_by[aid]
    return rmd_total, rmd_by


def _qcd_for_year(plan, status, year, rmd_total: float) -> tuple[float, float, float]:
    """Compute this year's Qualified Charitable Distribution.

    QCD rules (as of 2025):
    - Available only if the IRA owner is age 70½ or older that year.
    - Counts toward the year's RMD dollar-for-dollar.
    - Excluded from AGI (never enters taxable ordinary income).
    - IRS annual cap = $108,000 per eligible taxpayer (indexed each year).
    - QCDs above the RMD are still allowed (up to the annual cap) but this planner
      caps at RMD to keep the "reduce IRA balance" side-effect coherent with the
      cash-flow model (QCDs above RMD would still be permitted in real life; we
      err on the conservative side rather than model excess-QCD which is rare).

    Returns (qcd_total, qcd_client, qcd_spouse). All zero if disabled/out-of-window.
    """
    if plan.qcd_annual <= 0 or plan.qcd_start_year <= 0 or rmd_total <= 0:
        return 0.0, 0.0, 0.0
    if year < plan.qcd_start_year:
        return 0.0, 0.0, 0.0
    if plan.qcd_end_year and year > plan.qcd_end_year:
        return 0.0, 0.0, 0.0

    client_age = _age(plan.client_dob, year) if status.client_alive else -1
    spouse_age = (_age(plan.spouse_dob, year) if (plan.has_spouse and status.spouse_alive) else -1)

    # Age 70½ eligibility. We approximate with integer age ≥ 70 since the plan runs
    # at annual granularity. Half-year strictness would require DOB-month + timing.
    client_eligible = client_age >= 70
    spouse_eligible = spouse_age >= 70

    # Split the planned annual QCD between spouses per the household's Client share.
    # Each spouse is independently capped by the IRS per-taxpayer limit and by
    # whether they are eligible this year.
    share_c = plan.qcd_client_share if client_eligible else 0.0
    share_s = (1.0 - plan.qcd_client_share) if spouse_eligible else 0.0
    total_share = share_c + share_s
    if total_share <= 0:
        return 0.0, 0.0, 0.0
    # Re-normalize the shares in case one spouse became ineligible (survivor / not-yet-70)
    share_c /= total_share
    share_s /= total_share

    planned = min(plan.qcd_annual, rmd_total)
    qcd_c = min(planned * share_c, plan.qcd_annual_cap if client_eligible else 0.0)
    qcd_s = min(planned * share_s, plan.qcd_annual_cap if spouse_eligible else 0.0)
    qcd_total = qcd_c + qcd_s
    return qcd_total, qcd_c, qcd_s


def _total_expenses(expenses, year, client_alive, spouse_alive, both_alive,
                    start_year, survivor_reduction):
    """Sum active, inflated expenses for a year (survivor-adjusted after first death).

    Expenses inflate from the projection START year (matching the source sheet) and
    boundary years prorate by active day-count when start_date/stop_date are given.
    """
    total = 0.0
    for e in expenses:
        if not e.get("use", True):
            continue
        owner = e.get("owner", "Joint")
        owner_alive = (owner == "Joint" or (owner == "Client" and client_alive)
                       or (owner == "Spouse" and spouse_alive))
        if not owner_alive:
            continue
        sd = _parse_date(e.get("start_date"))
        ed = _parse_date(e.get("stop_date"))
        es = e.get("start_year", sd.year if sd else start_year)
        if sd or ed:
            frac = _active_fraction(sd, ed, year)
            if frac <= 0:
                continue
        else:
            ee = e.get("stop_year")
            if year < es or (ee and year > ee):
                continue
            frac = 1.0
        freq = 12 if e.get("frequency", "Annual") == "Monthly" else 1
        total += (e.get("amount", 0.0) * freq
                  * (1 + e.get("inflation", 0.03)) ** max(0, year - start_year)
                  * frac)
    if not both_alive:
        total *= (1 - survivor_reduction)
    return total


def _expense_line_items(expenses, year, client_alive, spouse_alive, both_alive,
                        start_year, survivor_reduction):
    """Per-expense-source breakdown for the Cashflow tab.

    Returns a list of {source, owner, category, amount} where `category` is derived
    from the expense name (best-effort tag: `spending`, `health`, `insurance`, `housing`,
    `gift`, `taxes`, `other`) so the frontend can group / color rows without re-parsing.
    The `amount` already includes inflation, day-count proration, AND the same
    survivor-reduction multiplier that `_total_expenses` applies to the aggregate —
    so summing this list equals the row's aggregate expenses to the cent.
    """
    factor = 1.0 - (survivor_reduction if not both_alive else 0.0)
    out = []
    for e in expenses:
        if not e.get("use", True):
            continue
        owner = e.get("owner", "Joint")
        owner_alive = (owner == "Joint" or (owner == "Client" and client_alive)
                       or (owner == "Spouse" and spouse_alive))
        if not owner_alive:
            continue
        sd = _parse_date(e.get("start_date"))
        ed = _parse_date(e.get("stop_date"))
        es = e.get("start_year", sd.year if sd else start_year)
        if sd or ed:
            frac = _active_fraction(sd, ed, year)
            if frac <= 0:
                continue
        else:
            ee = e.get("stop_year")
            if year < es or (ee and year > ee):
                continue
            frac = 1.0
        freq = 12 if e.get("frequency", "Annual") == "Monthly" else 1
        amt = (e.get("amount", 0.0) * freq
               * (1 + e.get("inflation", 0.03)) ** max(0, year - start_year)
               * frac * factor)
        if amt <= 0:
            continue
        name = (e.get("name") or e.get("category") or "Expense").strip()
        low = name.lower()
        if any(k in low for k in ("health", "medic", "dental", "vision")):
            cat = "health"
        elif any(k in low for k in ("insur", "premium")):
            cat = "insurance"
        elif any(k in low for k in ("home", "hous", "mortgage", "rent", "prop tax", "property tax", "hoa")):
            cat = "housing"
        elif any(k in low for k in ("gift", "donation", "charit", "tithe")):
            cat = "gift"
        elif any(k in low for k in ("tax",)):
            cat = "taxes"
        elif any(k in low for k in ("travel", "vacation", "living", "spend", "food", "groceries", "discretion", "auto", "car")):
            cat = "spending"
        else:
            cat = "other"
        out.append({
            "source": name,
            "owner": owner,
            "category": cat,
            "amount": round(amt, 2),
        })
    return out


@dataclass
class _HeirSleeves:
    """Mutable inherited-account balances + heir growth rates for the post-death horizon."""
    roth: float
    trad: float
    taxable: float
    reinvest: float
    cash: float
    re: float
    taxable0: float
    home0: float
    reinvest_basis: float
    roth_r: float
    trad_r: float
    tax_r: float
    cash_r: float
    re_r: float
    heir_rate: float
    heir_ltcg_rate: float
    gains_realized: bool = True
    cum_ira_tax: float = 0.0

    def step(self, y, years):
        """Advance one post-death year: deplete the inherited IRA, compound sleeves, build the row."""
        wd = self.trad / (years - y + 1)     # deplete remaining over remaining years
        self.trad -= wd
        tax = wd * self.heir_rate
        self.cum_ira_tax += tax
        self.reinvest += wd - tax            # after-tax proceeds reinvested
        self.reinvest_basis += wd - tax
        self.roth *= (1 + self.roth_r)       # tax-free compounding
        self.trad *= (1 + self.trad_r)
        self.taxable *= (1 + self.tax_r)
        self.reinvest *= (1 + self.tax_r)
        self.cash *= (1 + self.cash_r)
        self.re *= (1 + self.re_r)
        # heirs owe LTCG on post-death appreciation of the taxable/reinvest/home sleeves —
        # tracked per sleeve so we can attribute after-tax value back to Roth / IRA-reinvested / non-retirement.
        # When gains_realized is False (default), post-death appreciation is never realized
        # (heirs hold / re-step-up at their own deaths) so no LTCG is charged.
        rate = self.heir_ltcg_rate if self.gains_realized else 0.0
        ltcg_taxable  = rate * max(0.0, self.taxable  - self.taxable0)
        ltcg_reinvest = rate * max(0.0, self.reinvest - self.reinvest_basis)
        ltcg_re       = rate * max(0.0, self.re       - self.home0)
        # After-tax attribution buckets (sum == total_to_heirs when inherited_traditional ≈ 0
        # at end of the SECURE horizon; residual trad rolls into ira_post_tax on the final row).
        after_tax_roth = self.roth                                   # tax-free (settlement haircut already applied at t=0)
        after_tax_ira  = self.trad + self.reinvest - ltcg_reinvest   # inherited IRA depleted → after-tax proceeds compounding in taxable
        after_tax_nonret = (self.taxable - ltcg_taxable
                            + self.cash
                            + self.re - ltcg_re)                     # taxable brokerage + cash + real estate (step-up applied, LTCG on post-death appreciation)
        return {
            "year_after_death": y,
            "inherited_roth": round(self.roth, 2),
            "inherited_traditional": round(self.trad, 2),
            "ira_tax_paid": round(tax, 2),
            "taxable_and_reinvested": round(self.taxable + self.reinvest, 2),
            "cash": round(self.cash, 2),
            "real_estate": round(self.re, 2),
            "after_tax_roth": round(after_tax_roth, 2),
            "after_tax_ira_post_tax": round(after_tax_ira, 2),
            "after_tax_nonretirement": round(after_tax_nonret, 2),
            "total_to_heirs": round(after_tax_roth + after_tax_ira + after_tax_nonret, 2),
        }


def _init_heir_sleeves(final, accounts, heir_rate, settlement_pct, heir_return, heir_ltcg_rate, div_yield, gains_realized):
    """Resolve heir growth rates and the settlement-haircut initial balances."""
    def ret(tax_type, default):
        return next((a["return"] for a in accounts if a["tax_type"] == tax_type), default)

    override = heir_return is not None
    base_tax_r = heir_return if override else ret("Taxable", 0.07)
    tax_r = base_tax_r if override else (base_tax_r - div_yield * heir_ltcg_rate)  # dividend drag
    hc = 1 - settlement_pct  # settlement haircut at death (not applied to the inherited IRA)
    taxable0 = final.get("taxable", 0) * hc
    home0 = final.get("real_estate", 0) * hc
    return _HeirSleeves(
        roth=final.get("roth", 0) * hc,
        trad=final.get("traditional", 0),        # full balance — heirs pay income tax on it
        taxable=taxable0, reinvest=0.0, cash=final.get("cash", 0) * hc, re=home0,
        taxable0=taxable0, home0=home0, reinvest_basis=0.0,
        roth_r=heir_return if override else ret("Tax-Free", 0.07),
        trad_r=heir_return if override else ret("Tax-Deferred", 0.07),
        # Inherited home: heirs sell (tax-free via step-up) and reinvest at the heir
        # taxable-brokerage rate — matches the workbook's (Taxable+Home)×(1+r_heir)^n.
        tax_r=tax_r, cash_r=ret("Cash", 0.03), re_r=(heir_return if override else tax_r),
        heir_rate=heir_rate, heir_ltcg_rate=heir_ltcg_rate, gains_realized=gains_realized)


def _post_death_horizon(final, accounts, heir_rate, settlement_pct, years=10,
                        heir_return=None, heir_ltcg_rate=0.2345, div_yield=0.01,
                        gains_realized=False):
    """SECURE Act post-death inherited-account horizon after the 2nd death (matches V9).

    - Inherited Roth keeps compounding TAX-FREE (settlement haircut applied at death).
    - Inherited Traditional IRA is depleted over the horizon at the heirs' ordinary rate;
      after-tax proceeds reinvested in a taxable sleeve (no settlement haircut on the IRA).
    - Taxable & real estate received a basis step-up at death, then compound NET of the
      annual qualified-dividend tax drag; heirs owe LTCG on POST-death appreciation.
    `heir_return`, if provided, overrides the Roth/Traditional/taxable/reinvest growth rate.
    """
    sleeves = _init_heir_sleeves(final, accounts, heir_rate, settlement_pct,
                                 heir_return, heir_ltcg_rate, div_yield, gains_realized)
    rows = [sleeves.step(y, years) for y in range(1, years + 1)]
    total = rows[-1]["total_to_heirs"] if rows else 0.0
    return rows, round(total, 2), round(sleeves.cum_ira_tax, 2)


def _compute_legacy(cfg: dict, final: dict, accounts: list | None = None) -> dict:
    """Estate at second death + SECURE Act 10-year inherited-account horizon."""
    lc = cfg.get("legacy", {})
    settlement_pct = lc.get("estate_settlement_pct", 0.01)
    if "heir_federal_rate" in lc or "heir_state_rate" in lc:
        heir_ord_rate = lc.get("heir_federal_rate", 0.24) + lc.get("heir_state_rate", 0.0)
    else:
        heir_ord_rate = lc.get("heir_ordinary_rate", 0.30)
    step_up = lc.get("step_up_at_death", True)
    horizon = lc.get("post_death_years", 10)
    heir_return = lc.get("heir_reinvest_return")  # None -> use account returns
    heir_ltcg_rate = lc.get("heir_ltcg_rate", 0.188 + lc.get("heir_state_rate", 0.0))
    gains_realized = bool(lc.get("heir_gains_realized", False))
    div_yield = cfg.get("dividend_yield", 0.01)
    mortgage = cfg.get("mortgage_balance", 0.0)
    accounts = accounts if accounts is not None else cfg["accounts"]

    end_nw = final.get("net_worth", 0)
    end_trad = final.get("traditional", 0)
    end_roth = final.get("roth", 0)

    # Death-time charitable beneficiary designation on the Traditional IRA. The
    # designated fraction passes to qualified charity free of income tax (charity
    # pays none) and is excluded from the heirs' SECURE-10 drawdown; the estate
    # side gets a charitable deduction. frac == 0 is a strict no-op (golden-safe).
    frac = 0.0
    try:
        frac = float((cfg.get("beneficiary") or {}).get("ira_to_charity_fraction", 0.0) or 0.0)
    except (TypeError, ValueError):
        frac = 0.0
    frac = max(0.0, min(1.0, frac))
    charitable_ira = round(end_trad * frac, 2) if frac > 0 else 0.0
    heir_trad = end_trad * (1.0 - frac)
    final_heir = final if frac <= 0 else {**final, "traditional": heir_trad}

    gross_estate = max(0.0, end_nw - mortgage)
    estate_settlement = settlement_pct * gross_estate

    # immediate (at-death) after-tax value — PV-at-death approximation
    inherited_ira_tax_at_death = heir_trad * heir_ord_rate
    after_tax_at_death = gross_estate - estate_settlement - inherited_ira_tax_at_death - charitable_ira

    # post-death forward value (mirrors the spreadsheet longevity view)
    post_rows, total_10yr, cum_ira_tax = _post_death_horizon(
        final_heir, accounts, heir_ord_rate, settlement_pct, horizon, heir_return,
        heir_ltcg_rate, div_yield, gains_realized)

    # After-tax attribution: use the FINAL horizon row so the split lines up with total_10yr.
    # These three fields sum to `after_tax_estate_to_heirs` — useful for UI break-out rows.
    if post_rows:
        _final = post_rows[-1]
        roth_to_heirs         = _final["after_tax_roth"]
        ira_post_tax_to_heirs = _final["after_tax_ira_post_tax"]
        nonretirement_to_heirs = _final["after_tax_nonretirement"]
    else:
        roth_to_heirs = round(end_roth, 2)
        ira_post_tax_to_heirs = round(end_trad * (1 - heir_ord_rate), 2)
        nonretirement_to_heirs = round(gross_estate - end_roth - end_trad - estate_settlement, 2)

    return {
        "gross_estate": round(gross_estate, 2),
        "estate_settlement": round(estate_settlement, 2),
        "inherited_ira_tax": round(cum_ira_tax, 2),
        "tax_free_roth_to_heirs": post_rows[-1]["inherited_roth"] if post_rows else round(end_roth, 2),
        "after_tax_estate_to_heirs": total_10yr,
        "roth_to_heirs": roth_to_heirs,
        "ira_post_tax_to_heirs": ira_post_tax_to_heirs,
        "nonretirement_to_heirs": nonretirement_to_heirs,
        "after_tax_estate_at_death": round(after_tax_at_death, 2),
        "heir_ordinary_rate": round(heir_ord_rate, 4),
        "heir_federal_rate": lc.get("heir_federal_rate"),
        "heir_state_rate": lc.get("heir_state_rate"),
        "heir_reinvest_return": heir_return,
        "heir_ltcg_rate": round(heir_ltcg_rate, 4),
        "heir_gains_realized": gains_realized,
        "step_up_at_death": step_up,
        "horizon_years": horizon,
        "post_death_rows": post_rows,
        **({"ira_to_charity_fraction": round(frac, 4),
            "charitable_ira_amount": charitable_ira} if frac > 0 else {}),
    }


def _withdraw(plan, shortfall, bal, basis, rmd_by, conversion_reserve=0.0):
    """Withdraw `shortfall` (after cash) honoring plan.funding_order.

    Cash is always spent before this; Roth is always last. The middle tier
    (Taxable vs Traditional IRA) order/split is governed by plan.funding_order.

    `rmd_by` is a per-IRA {account_id: rmd_dollar_amount} map so this year's mandatory
    distributions are reserved from the CORRECT accounts (not just the first IRA). Fixes
    a stale bug where RMDs from the Spouse IRA weren't reserved once Client IRA depleted.
    `conversion_reserve` is the Roth conversion this year (drained from IRAs in the
    same order as discretionary withdrawal). Reserving it here prevents the discretionary
    IRA-withdrawal from overshooting the balance in the IRA-depletion year — the
    workbook enforces the same `conversion + discretionary + RMD ≤ BOY balance` rule.
    Returns (withdrawals {id: amount}, realized_ltcg, ira_withdraw, roth_withdraw,
    basis_consumed {taxable_id: basis dollars sold} — mirrors the workbook's
    "Basis Consumed" rows: consumed = withdrawal × (1 − gain%) on BOY values).
    """
    wd = {}
    basis_consumed = {}
    realized_ltcg = ira_withdraw = roth_withdraw = 0.0
    if shortfall <= 0:
        return wd, realized_ltcg, ira_withdraw, roth_withdraw, basis_consumed

    # Per-IRA conversion reservation: conversion is applied Client-first, Spouse-second
    # (mirrors _apply_year_flows), so reserve capacity in the same order.
    conv_left = conversion_reserve
    conv_by_ira = {}
    for iid in plan.ira_ids:
        if conv_left <= 0:
            break
        rmd_here = rmd_by.get(iid, 0.0)
        room = max(0.0, bal[iid] - rmd_here)
        take = min(room, conv_left)
        conv_by_ira[iid] = take
        conv_left -= take

    def cap(aid, is_ira):
        taken = wd.get(aid, 0.0)
        reserve = rmd_by.get(aid, 0.0) if is_ira else 0.0
        conv = conv_by_ira.get(aid, 0.0) if is_ira else 0.0
        return max(0.0, bal[aid] - taken - reserve - conv)

    def take_from(ids, amount, kind):
        nonlocal realized_ltcg, ira_withdraw, roth_withdraw
        for aid in ids:
            if amount <= 0:
                break
            t = min(amount, cap(aid, kind == "ira"))
            if t <= 0:
                continue
            wd[aid] = wd.get(aid, 0.0) + t
            if kind == "taxable":
                gain_pct = max(0.0, 1 - basis[aid] / bal[aid]) if bal[aid] > 0 else 0.0
                realized_ltcg += t * gain_pct
                basis_consumed[aid] = basis_consumed.get(aid, 0.0) + t * (1 - gain_pct)
            elif kind == "ira":
                ira_withdraw += t
            elif kind == "roth":
                roth_withdraw += t
            amount -= t
        return amount

    remaining = shortfall
    if plan.funding_order == "Split IRA & Taxable":
        left = take_from(plan.ira_ids, remaining * plan.ira_split, "ira")
        left += take_from(plan.taxable_ids, remaining - remaining * plan.ira_split, "taxable")
        left = take_from(plan.ira_ids, left, "ira")        # overflow if one bucket dry
        remaining = take_from(plan.taxable_ids, left, "taxable")
    elif plan.funding_order == "Cash → IRA → Taxable → Roth":
        remaining = take_from(plan.ira_ids, remaining, "ira")
        remaining = take_from(plan.taxable_ids, remaining, "taxable")
    else:  # default: Cash → Taxable → IRA → Roth
        remaining = take_from(plan.taxable_ids, remaining, "taxable")
        remaining = take_from(plan.ira_ids, remaining, "ira")
    take_from(plan.roth_ids, remaining, "roth")            # Roth always last
    return wd, realized_ltcg, ira_withdraw, roth_withdraw, basis_consumed


@dataclass
class YearFlows:
    """Year-end cash flows applied to balances after growth (param object for
    _apply_year_flows, which would otherwise take a long positional list)."""
    cash_need: float
    rmd_by: dict
    ira_draw: float          # conversion + discretionary IRA withdrawal
    wd: dict
    roth_withdraw: float
    conversion: float
    surplus: float
    conv_deposits: dict = None   # {roth_account_id: amount} — same-owner routing
    basis_consumed: dict = None  # {taxable_id: basis dollars sold} — workbook "Basis Consumed"


def _living_owner_target(plan, ids, status):
    """First account in `ids` whose ORIGINAL owner is still alive. New money (a
    surplus sweep) must not land in a dead spouse's account — after a first death
    the balances are retitled to the survivor, so continuing to credit the
    decedent's account would resurrect that row."""
    if not ids:
        return None
    if status is None:
        return ids[0]
    orig = {a["id"]: a.get("owner", "Client") for a in plan.accounts}
    for aid in ids:
        o = orig.get(aid, "Client")
        if o == "Joint" or (o == "Client" and status.client_alive) or (o == "Spouse" and status.spouse_alive):
            return aid
    return ids[0]


def _apply_year_flows(plan, bal, basis, flows, status=None):
    """Apply one year's flows AFTER growth (mirrors the sheet's EOY = BOY×(1+r) ± flows):
    cash spend, per-account RMD, conversion + discretionary IRA withdrawal (client IRA
    first), taxable/Roth withdrawals, conversion in, surplus sweep.

    `flows.cash_need` is the spending shortfall after fundable income; cash covers it first.
    Withdrawal dollar amounts were sized on BOY balances by the circular solver.
    """
    acct = plan.acct
    # cash covers the income-shortfall first (proportional across grown cash balances)
    cash_total = sum(bal[i] for i in acct["cash"])
    spend_from_cash = min(cash_total, max(0.0, flows.cash_need))
    for i in acct["cash"]:
        bal[i] = max(0.0, bal[i] - (spend_from_cash * (bal[i] / cash_total if cash_total else 0)))
    # each tax-deferred account satisfies its OWN RMD
    for iid in acct["ira"]:
        bal[iid] = max(0.0, bal[iid] - flows.rmd_by.get(iid, 0.0))
    # conversion + discretionary IRA withdrawal drawn in account order (client IRA first).
    # WORKBOOK CONVENTION: in the transition year when the first IRA depletes mid-year, the
    # spreadsheet does NOT cascade the remaining draw to the next IRA — it clamps the debit
    # at zero and leaves the reported discretionary as a "phantom" that funds expenses/taxes.
    # We mirror that here: drain the first non-empty IRA to zero and stop. This matches the
    # V17 workbook's numbers on Client-IRA-depletion years (typically one year mid-plan)
    # without changing behaviour in years when the first IRA can cover the whole draw.
    rem = flows.ira_draw
    for iid in acct["ira"]:
        if bal[iid] <= 0:
            continue                       # skip already-empty accounts
        t = min(rem, bal[iid])
        bal[iid] -= t
        rem -= t
        break                              # workbook: no cascade to next IRA (phantom debit)
    # taxable discretionary withdrawals per converged waterfall; each sale consumes
    # its pro-rata cost basis (workbook: basis_EOY = MAX(0, basis_BOY − consumed) + sweep)
    for aid, amt in flows.wd.items():
        if aid in acct["taxable_set"]:
            bal[aid] = max(0.0, bal[aid] - amt)
            if flows.basis_consumed:
                basis[aid] = max(0.0, basis[aid] - flows.basis_consumed.get(aid, 0.0))
    # roth withdrawals, then conversion lands in roth
    rem = flows.roth_withdraw
    for rid in acct["roth"]:
        t = min(rem, bal[rid])
        bal[rid] -= t
        rem -= t
    if flows.conversion > 0 and acct["roth"]:
        # route each converted dollar to the source-IRA owner's own Roth account
        deposits = flows.conv_deposits or {acct["roth"][0]: flows.conversion}
        for rid, amt in deposits.items():
            bal[rid] += amt
    # reinvest surplus (after-tax) — default to taxable brokerage (gross return), add basis
    if flows.surplus > 0:
        tax_id = _living_owner_target(plan, acct["taxable"], status)
        if plan.surplus_sweep_to == "Taxable" and tax_id:
            bal[tax_id] += flows.surplus
            basis[tax_id] += flows.surplus
        elif acct["cash"]:
            cash_id = _living_owner_target(plan, acct["cash"], status)
            bal[cash_id] += flows.surplus


RISKY_TAX_TYPES = ("Taxable", "Tax-Deferred", "Tax-Free")


def _grow_balances(bal, accounts, div_yield, eq=None):
    """End-of-year growth: taxable appreciates net of dividend yield; others at full return.

    `eq` is the sequence-of-returns hook: (equity_share, equity_return_this_year).
    When supplied, every market-exposed account grows at
    `w x equity_return + (1 - w) x its own flat return` for THAT year, so only the
    equity sleeve takes the shock (cash and the residence keep their own rates).
    """
    for a in accounts:
        aid, r = a["id"], a["return"]
        if eq is not None and a["tax_type"] in RISKY_TAX_TYPES:
            w, e = eq
            r = w * e + (1 - w) * r
        if a["tax_type"] == "Taxable":
            bal[aid] *= (1 + (r - div_yield))
        elif a["tax_type"] in ("Tax-Deferred", "Tax-Free", "Cash", "Real Estate"):
            bal[aid] *= (1 + r)


@dataclass
class _SolveCtx:
    """Per-year inputs for the conversion/withdrawal circular solver (groups what would
    otherwise be a dozen positional args)."""
    tax_base: dict
    in_window: bool
    target_rate: float
    max_annual: float
    irmaa_cap: Any
    mfj: bool
    irmaa_index_yplus2: float
    irmaa_magi: Any
    rmd_total: float
    rmd_by: dict           # per-IRA {account_id: rmd_amount} for correct per-account reservation
    cash_boy: float
    total_expense: float
    ira_balance: float
    plan: "Plan"
    qcd_total: float = 0.0  # QCD portion of RMD — excluded from taxable ordinary income & fundable cash


def _solve_year_conversion(ctx: _SolveCtx, bal: dict, basis: dict):
    """Resolve the circular conversion <-> discretionary-IRA-withdrawal <-> tax relationship
    for one year. The conversion fills the target bracket on TOP of RMDs and any discretionary
    IRA withdrawal used to fund spending (IRA-first funding consumes bracket room, leaving less
    for conversion — mirrors the spreadsheet's iterative solver). Cash interest is taxed but
    retained in cash, so it is NOT counted as fundable income.

    Ordering (matches workbook V17 exactly):
    1) Withdraw for spending FIRST via `_withdraw` (funding_order priority Cash→IRA→…).
    2) THEN size conversion at `min(bracket_room, ira_balance - RMD - ira_withdraw)`.
    The IRA is shared: whatever spending doesn't take, conversion can fill.

    Returns (conversion, tax_res, wd, realized_ltcg, ira_withdraw, roth_withdraw).
    """
    realized_ltcg = ira_withdraw = roth_withdraw = conversion = 0.0
    wd, tax_res, basis_consumed = {}, {}, {}
    prev_conv = prev_wd = -1.0
    max_total_ira = max(0.0, ctx.ira_balance - ctx.rmd_total)  # room left after RMDs
    # QCDs count toward the RMD but are EXCLUDED from AGI — subtract them wherever
    # `rmd_total` was previously treated as taxable ordinary income (ira_distributions)
    # OR as fundable cash-in for the household (QCDs go directly to charity).
    taxable_rmd = max(0.0, ctx.rmd_total - ctx.qcd_total)
    for _ in range(40):
        # 1) Tax with the CURRENT conv & iw estimates
        tax_inp = {**ctx.tax_base,
                   "ira_distributions": taxable_rmd + conversion + ira_withdraw,
                   "realized_ltcg": realized_ltcg, "irmaa_magi": ctx.irmaa_magi}
        tax_res = compute_year_tax(tax_inp)
        total_tax = tax_res["total_burden"]

        # 2) Discretionary withdrawal for spending — funding_order priority (Cash→IRA→…).
        #    Reserve the pending conversion in the IRA pool so the two don't over-draw the
        #    account. This matches the workbook's "IRA Pool Available (BOY net of RMD &
        #    conversions)" label.
        funding_income = (ctx.tax_base["ordinary_non_ss"] + ctx.tax_base["gross_ss"]
                          + ctx.tax_base["recurring_div_ltcg"] + taxable_rmd)
        shortfall = (ctx.total_expense + total_tax) - funding_income - ctx.cash_boy
        wd, realized_ltcg, ira_withdraw, roth_withdraw, basis_consumed = _withdraw(
            ctx.plan, shortfall, bal, basis, ctx.rmd_by, conversion_reserve=conversion)

        # 3) Now size conversion given the discretionary iw just chosen (fills bracket to
        #    the target ceiling, capped by whatever IRA remains after RMD + iw — matches
        #    the workbook's CashFlow!r17 cap `MAX(0, bal − RMD − discretionary_wd)`).
        conversion = 0.0
        if ctx.in_window:
            base_inp = {**ctx.tax_base, "ira_distributions": taxable_rmd + ira_withdraw,
                        "realized_ltcg": realized_ltcg}
            opt = optimize_conversion(base_inp, ctx.target_rate, ctx.max_annual)
            conversion = min(opt["recommended_conversion"], max(0.0, max_total_ira - ira_withdraw))
            if ctx.irmaa_cap is not None:
                magi_ceiling = irmaa_threshold_cap(int(ctx.irmaa_cap), ctx.mfj, ctx.irmaa_index_yplus2)
                conversion = min(conversion, max(0.0, magi_ceiling - opt["before"]["magi"]))

        if abs(conversion - prev_conv) < 1.0 and abs(ira_withdraw - prev_wd) < 1.0:
            break
        prev_conv, prev_wd = conversion, ira_withdraw
    return conversion, tax_res, wd, realized_ltcg, ira_withdraw, roth_withdraw, basis_consumed


def _aggregate_results(cfg: dict, rows: list, warnings: list | None = None,
                       ledger: list | None = None, auto_accounts: list | None = None,
                       accounts: list | None = None,
                       gift_pot_by_year: dict | None = None,
                       taxable_gifts_summary: dict | None = None,
                       gift_pot_basis: float = 0.0) -> dict:
    """Roll year rows up into summary totals + the legacy block + Roth compliance."""
    final = rows[-1] if rows else {}
    total_early_penalty = round(sum(w.get("penalty_10pct", 0.0) for w in (warnings or [])), 2)
    _gpby = gift_pot_by_year or {}
    total_gifted = round(sum(v.get("contributed", 0.0) for v in _gpby.values()), 2)
    ending_pot = round((_gpby.get(sorted(_gpby.keys())[-1], {}).get("cumulative_pot", 0.0)) if _gpby else 0.0, 2)
    giving = {
        "annual_pot": _gpby,
        "total_gifted": total_gifted,
        "ending_pot": ending_pot,
    }
    # §1015 carryover-basis after-tax view of the family gift pot. Gifted assets
    # take the donor's basis (NO §1014 step-up), so heirs owe LTCG on the embedded
    # gain when they eventually sell. Additive fields — present ONLY when a pot
    # exists, so no-gift configs stay byte-identical to the golden baseline.
    if ending_pot > 0:
        lc = cfg.get("legacy", {}) or {}
        heir_ltcg_rate = lc.get("heir_ltcg_rate", 0.188 + lc.get("heir_state_rate", 0.0))
        pot_basis = round(min(gift_pot_basis, ending_pot), 2)
        embedded_gain = round(max(0.0, ending_pot - pot_basis), 2)
        pot_after_tax = round(ending_pot - embedded_gain * heir_ltcg_rate, 2)
        giving["carryover_basis"] = {
            "pot_basis": pot_basis,
            "embedded_gain": embedded_gain,
            "heir_ltcg_rate": round(heir_ltcg_rate, 4),
            "ltcg_owed_at_sale": round(embedded_gain * heir_ltcg_rate, 2),
            "pot_after_tax": pot_after_tax,
        }
    # Additive only — the key is present ONLY when taxable gifts exist, so configs
    # without them stay byte-identical to the golden baseline.
    if taxable_gifts_summary:
        giving["taxable_gifts"] = taxable_gifts_summary
    return {
        "rows": rows,
        "auto_accounts": auto_accounts or [],
        "summary": {
            "years": len(rows),
            "total_roth_converted": round(sum(r["roth_conversion"] for r in rows), 2),
            "lifetime_taxes": round(sum(r["total_tax"] for r in rows), 2),
            "lifetime_qcd": round(sum(r.get("qcd", 0.0) for r in rows), 2),
            "ending_net_worth": final.get("net_worth", 0),
            "ending_roth": final.get("roth", 0),
            "ending_traditional": final.get("traditional", 0),
            "ending_taxable": final.get("taxable", 0),
            "ending_real_estate": final.get("real_estate", 0),
            "roth_early_penalty_total": total_early_penalty,
            "lifetime_gifted": total_gifted,
            "gift_pot_at_second_death": ending_pot,
        },
        "legacy": _compute_legacy(cfg, final, accounts=accounts),
        "giving": giving,
        "roth_compliance": {
            "warnings": warnings or [],
            "conversions_ledger": ledger or [],
            "total_early_penalty": total_early_penalty,
        },
    }


@dataclass
class Plan:
    """Parsed, immutable plan configuration + account partitions."""
    cfg: dict
    start_year: int
    end_year: int
    bracket_index_rate: float
    irmaa_index_rate: float
    client_dob: int
    spouse_dob: Any
    client_death: int
    spouse_death: int
    has_spouse: bool
    state_rate: float
    state_code: str
    state_move: dict | None  # {year, from, to} — mid-plan single state change; None if unused
    community_property: bool
    include_irmaa: bool
    survivor_status: str
    roth_enabled: bool
    conv_start: int
    conv_end: int
    target_rate: float
    max_annual: float
    stop_at_rmd: bool
    irmaa_cap: Any
    year_targets: dict     # optional {year: bracket_rate} override for phased schedules
    streams: list
    expenses: list
    accounts: list
    div_yield: float
    cash_rate: float
    funding_order: str
    ira_split: float
    surplus_sweep_to: str
    survivor_spending_reduction: float
    cash_ids: list
    taxable_ids: list
    ira_ids: list
    roth_ids: list
    other_ids: list
    taxable_set: set
    rmd_reserve_id: Any
    acct: dict
    auto_accounts: list
    # ----- Qualified Charitable Distribution (QCD) settings -----
    # Annual QCD dollar amount the household intends to route directly from IRA to
    # a 501(c)(3) charity. QCDs count toward the year's RMD dollar-for-dollar and
    # are EXCLUDED from AGI (never enter taxable ordinary income). Capped at the
    # 2025 IRS annual limit ($108,000 per eligible taxpayer ≥ 70½). Only owners
    # who are ≥ 70½ this year can contribute their share.
    qcd_annual: float = 0.0
    qcd_start_year: int = 0            # 0 = disabled
    qcd_end_year: int = 0              # 0 = run through end_year
    qcd_client_share: float = 1.0      # 1.0 = 100% from Client, 0.5 = 50/50, 0.0 = 100% Spouse
    qcd_annual_cap: float = _QCD_CAP_DEFAULT   # per-taxpayer IRS annual cap (2026)
    # ----- Basis Merge Toggle (workbook parity) -----
    # When True, all Taxable accounts pool into ONE blended-basis account at
    # first death (matches the spreadsheet's Legacy-page behavior). When False,
    # accounts stay separate — the stepped-up lot is spent first, which is the
    # tax-efficient real-world behavior but produces a small delta vs the sheet.
    merge_basis_at_first_death: bool = True
    # ----- Lifetime Giving Program -----
    # Annual exclusion gifts (2026: $19K/donor/donee) + §2503(e) direct medical/
    # tuition payments. Both drain the taxable brokerage annually and compound
    # in a family-side "gift pot" at the heir reinvestment rate.
    annual_gift_amount: float = 0.0    # $/yr (both spouses combined)
    section_2503e_amount: float = 0.0  # $/yr direct medical/tuition (unlimited)
    gift_start_year: int = 0           # 0 = disabled
    gift_end_year: int = 0             # 0 = run through end_year
    # ----- Taxable lifetime gifts (§2001(b) unified transfer-tax mechanics) -----
    # Gifts ABOVE the annual exclusion that consume the donor's unified credit.
    # Each entry: {"year": int, "amount": float, "donor": "Client"|"Spouse"|"Joint"}.
    # Absent/empty (the normal case) => strict no-op (golden-safe).
    taxable_gifts: list = field(default_factory=list)
    # ----- Sequence-of-returns path (optional) -----
    # {"start_year": int, "equity_share": float, "equity_returns": [r_2026, r_2027, ...]}
    # Absent (the normal case) => every account compounds at its own flat return.
    return_path: dict | None = None


def _auto_roth_accounts(accounts: list) -> list:
    """Per-owner conversion routing: every IRA owner needs a same-owner Roth to receive
    their converted dollars. Synthesize a $0 Roth IRA (same return as the owner's IRA)
    for any Client/Spouse IRA owner without one. Never mutates the caller's config."""
    ira_owners = {a.get("owner", "Client") for a in accounts if a["tax_type"] == "Tax-Deferred"}
    roth_owners = {a.get("owner", "Client") for a in accounts if a["tax_type"] == "Tax-Free"}
    autos = []
    for owner in ("Client", "Spouse"):
        if owner in ira_owners and owner not in roth_owners:
            r = next(a["return"] for a in accounts
                     if a["tax_type"] == "Tax-Deferred" and a.get("owner", "Client") == owner)
            autos.append({"id": f"ROTH-AUTO-{owner.upper()}", "owner": owner,
                          "name": f"{owner} Roth IRA (auto-created)", "tax_type": "Tax-Free",
                          "beginning_balance": 0.0, "cost_basis": 0.0, "return": r})
    return autos


def _parse_return_path(cfg: dict) -> dict | None:
    """Validate the optional sequence-of-returns path (see Plan.return_path)."""
    rp = cfg.get("return_path")
    if not isinstance(rp, dict):
        return None
    seq = rp.get("equity_returns")
    if not isinstance(seq, list) or not seq:
        return None
    return {
        "start_year": int(rp.get("start_year") or cfg["projection"]["start_year"]),
        "equity_share": max(0.0, min(1.0, float(rp.get("equity_share", 0.6)))),
        "equity_returns": [float(x) for x in seq],
    }


def _equity_for_year(plan: "Plan", year: int):
    """(equity_share, equity_return) for `year`, or None outside the supplied path."""
    rp = plan.return_path
    if not rp:
        return None
    i = year - rp["start_year"]
    seq = rp["equity_returns"]
    if 0 <= i < len(seq):
        return (rp["equity_share"], seq[i])
    return None


def _parse_taxable_gifts(raw) -> list:
    """Validate the optional taxable-lifetime-gifts array (see Plan.taxable_gifts).

    Each entry: {"year": int, "amount": float, "donor": "Client"|"Spouse"|"Joint"}.
    These are gifts ABOVE the annual exclusion — they consume the donor's unified
    credit and enter the §2001(b) tentative-tax base at death. Malformed / zero
    entries are dropped so an empty/absent array is a strict no-op (golden-safe).
    """
    if not isinstance(raw, list):
        return []
    out = []
    for g in raw:
        if not isinstance(g, dict):
            continue
        try:
            yr = int(g.get("year"))
            amt = float(g.get("amount") or 0.0)
        except (TypeError, ValueError):
            continue
        if amt <= 0:
            continue
        donor = (str(g.get("donor") or "Joint")).strip().title()
        if donor not in ("Client", "Spouse", "Joint"):
            donor = "Joint"
        out.append({"year": yr, "amount": amt, "donor": donor})
    return out


def _first_decedent_donor(plan: "Plan") -> str:
    """Which spouse dies FIRST ('Client' or 'Spouse'). Single filers -> 'Client'."""
    if not plan.has_spouse or plan.spouse_dob is None:
        return "Client"
    c_death = plan.client_dob + plan.client_death
    s_death = plan.spouse_dob + plan.spouse_death
    return "Client" if c_death <= s_death else "Spouse"


def _split_adjusted_gifts(plan: "Plan", by_donor: dict) -> tuple[float, float]:
    """Map per-donor cumulative adjusted taxable gifts onto the (first_death,
    second_death) tuple the estate engine's §2001(b) base expects."""
    if not plan.has_spouse or plan.spouse_dob is None:
        # Single filer: everything lands on the (only) decedent.
        return round(by_donor.get("Client", 0.0) + by_donor.get("Spouse", 0.0), 2), 0.0
    first = _first_decedent_donor(plan)
    second = "Spouse" if first == "Client" else "Client"
    return round(by_donor.get(first, 0.0), 2), round(by_donor.get(second, 0.0), 2)


def _cfg_adjusted_gifts(cfg: dict) -> tuple[float, float]:
    """Approximate (first_death, second_death) adjusted taxable gifts straight from
    cfg (sum by donor, mapped to first/second decedent). Used by the funding-order
    estate helper which only has cfg + rows, not the full projection result."""
    gifts = _parse_taxable_gifts((cfg.get("giving", {}) or {}).get("taxable_gifts"))
    if not gifts:
        return 0.0, 0.0
    by_donor = {"Client": 0.0, "Spouse": 0.0}
    for g in gifts:
        if g["donor"] == "Joint":
            by_donor["Client"] += g["amount"] / 2.0
            by_donor["Spouse"] += g["amount"] / 2.0
        else:
            by_donor[g["donor"]] += g["amount"]
    h = cfg.get("household", {}) or {}
    has_spouse = h.get("spouse_dob_year") is not None
    if not has_spouse:
        return round(by_donor["Client"] + by_donor["Spouse"], 2), 0.0
    c_death = (h.get("client_dob_year") or 0) + (h.get("client_life_expectancy") or 0)
    s_death = (h.get("spouse_dob_year") or 0) + (h.get("spouse_life_expectancy") or 0)
    first = "Client" if c_death <= s_death else "Spouse"
    second = "Spouse" if first == "Client" else "Client"
    return round(by_donor[first], 2), round(by_donor[second], 2)


def _drain_for_gift(plan: "Plan", bal: dict, basis: dict, amount: float, donor: str) -> tuple[float, float]:
    """Drain `amount` for a taxable gift from Taxable brokerage (donor-owned first,
    then Joint, then the other spouse's), then Cash. Consumes basis pro-rata on the
    taxable side. Under §1015 the donee takes the donor's CARRYOVER basis (no §1014
    step-up), so we report the basis that travels with the gift: the pro-rata basis
    consumed on Taxable lots + the full face value drawn from Cash (cash carries
    basis = face, i.e. no embedded gain).
    Returns (unfunded_remainder, carryover_basis_transferred)."""
    remaining = float(amount)
    carryover_basis = 0.0
    orig_owner = {a["id"]: a.get("owner", "Client") for a in plan.accounts}

    def _order(ids):
        if donor in ("Client", "Spouse"):
            own = [i for i in ids if orig_owner.get(i) == donor]
            joint = [i for i in ids if orig_owner.get(i) == "Joint"]
            other = [i for i in ids if i not in own and i not in joint]
            return own + joint + other
        return list(ids)

    for aid in _order(plan.taxable_ids):
        if remaining <= 0:
            break
        cur_bal = bal.get(aid, 0.0)
        take = min(remaining, cur_bal)
        if take <= 0:
            continue
        if cur_bal > 0:
            b_frac = min(1.0, basis.get(aid, 0.0) / cur_bal)
            carryover_basis += take * b_frac
            basis[aid] = max(0.0, basis.get(aid, 0.0) - take * b_frac)
        bal[aid] = max(0.0, cur_bal - take)
        remaining -= take
    for aid in _order(plan.cash_ids):
        if remaining <= 0:
            break
        take = min(remaining, bal.get(aid, 0.0))
        if take <= 0:
            continue
        carryover_basis += take  # cash carries full basis (no embedded gain)
        bal[aid] = max(0.0, bal.get(aid, 0.0) - take)
        remaining -= take
    return max(0.0, remaining), carryover_basis



def _parse_plan(cfg: dict) -> Plan:
    """Pull every scalar/list the projection loop needs out of the raw config once."""
    h = cfg["household"]
    p = cfg["projection"]
    roth = cfg["roth"]
    irmaa_cap = roth.get("irmaa_tier_cap")  # None = no cap; int tier (0=base/no surcharge)
    if irmaa_cap in ("", "None", "none"):
        irmaa_cap = None
    auto_accounts = _auto_roth_accounts(cfg["accounts"])
    accounts = list(cfg["accounts"]) + auto_accounts
    cash_ids = [a["id"] for a in accounts if a["tax_type"] == "Cash"]
    taxable_ids = [a["id"] for a in accounts if a["tax_type"] == "Taxable"]
    ira_ids = [a["id"] for a in accounts if a["tax_type"] == "Tax-Deferred"]
    roth_ids = [a["id"] for a in accounts if a["tax_type"] == "Tax-Free"]
    other_ids = [a["id"] for a in accounts if a["tax_type"] in ("Real Estate",)]
    taxable_set = set(taxable_ids)
    wd_cfg = cfg.get("withdrawal", {})
    # Per spec: model uses ONE assumed CPI (config.projection.general_inflation)
    # for all bracket + IRMAA indexing — same convention as the spreadsheet's
    # BracketInfl variable. If separate values are set on a legacy scenario the
    # explicit override still wins, but the default is the general inflation
    # rate, NOT a fixed 3% chained-CPI.
    _gi = float(p.get("general_inflation", 0.03) or 0.03)
    _brk = p.get("bracket_indexing")
    _irm = p.get("irmaa_indexing")
    return Plan(
        cfg=cfg,
        start_year=p["start_year"], end_year=p["end_year"],
        bracket_index_rate=float(_brk) if _brk is not None else _gi,
        irmaa_index_rate=float(_irm) if _irm is not None else _gi,
        client_dob=h["client_dob_year"], spouse_dob=h.get("spouse_dob_year"),
        client_death=h["client_life_expectancy"],
        spouse_death=h.get("spouse_life_expectancy", 200),
        has_spouse=h.get("spouse_dob_year") is not None,
        state_rate=cfg["tax"]["state_rate"],
        state_code=(cfg["tax"].get("state_code") or "").strip().upper(),
        state_move=_normalize_state_move(cfg["tax"].get("state_move")),
        community_property=cfg["tax"].get("community_property", False),
        include_irmaa=cfg["tax"].get("include_irmaa", True),
        survivor_status=cfg["tax"].get("survivor_filing_status", "Single"),
        roth_enabled=roth.get("enabled", True),
        conv_start=roth.get("start_year", p["start_year"]),
        conv_end=roth.get("end_year", p["end_year"]),
        target_rate=roth.get("target_bracket", 0.24),
        max_annual=roth.get("max_annual", 0.0),
        stop_at_rmd=roth.get("stop_at_rmd_age", True),
        irmaa_cap=irmaa_cap,
        # normalize JSON string keys ("2026") to ints so HTTP payloads work
        year_targets={int(k): float(v) for k, v in (roth.get("year_targets") or {}).items()},
        streams=cfg["income_streams"], expenses=cfg["expenses"], accounts=accounts,
        div_yield=cfg.get("dividend_yield", 0.01),
        cash_rate=next((a["return"] for a in accounts if a["tax_type"] == "Cash"), 0.03),
        funding_order=wd_cfg.get("funding_order", "Cash → Taxable → IRA → Roth"),
        ira_split=wd_cfg.get("ira_split", 0.5),
        surplus_sweep_to=wd_cfg.get("surplus_sweep_to", "Taxable"),
        survivor_spending_reduction=cfg["tax"].get("survivor_spending_reduction", 0.2),
        cash_ids=cash_ids, taxable_ids=taxable_ids, ira_ids=ira_ids, roth_ids=roth_ids,
        other_ids=other_ids, taxable_set=taxable_set,
        rmd_reserve_id=(ira_ids[0] if ira_ids else None),
        acct={"cash": cash_ids, "taxable": taxable_ids, "ira": ira_ids,
              "roth": roth_ids, "other": other_ids, "taxable_set": taxable_set},
        auto_accounts=auto_accounts,
        qcd_annual=float(h.get("qcd_annual_amount") or 0.0),
        qcd_start_year=int(h.get("qcd_start_year") or 0),
        qcd_end_year=int(h.get("qcd_end_year") or 0),
        qcd_client_share=max(0.0, min(1.0, float(h.get("qcd_client_share", 1.0)))),
        qcd_annual_cap=float(h.get("qcd_annual_cap") or _QCD_CAP_DEFAULT),
        merge_basis_at_first_death=bool(cfg["tax"].get("merge_basis_at_first_death", True)),
        annual_gift_amount=float(cfg.get("giving", {}).get("annual_gift_amount") or 0.0),
        section_2503e_amount=float(cfg.get("giving", {}).get("section_2503e_amount") or 0.0),
        gift_start_year=int(cfg.get("giving", {}).get("start_year") or 0),
        gift_end_year=int(cfg.get("giving", {}).get("end_year") or 0),
        taxable_gifts=_parse_taxable_gifts(cfg.get("giving", {}).get("taxable_gifts")),
        return_path=_parse_return_path(cfg),
    )


@dataclass
class YearStatus:
    """Per-year demographic / filing state."""
    client_alive: bool
    spouse_alive: bool
    both_alive: bool
    anyone_alive: bool
    filing: str
    mfj: bool
    survivor_owner: Any
    num65: int
    med_count: int


def _step_up_basis(plan, owner_map, basis, bal, decedent):
    """First-death cost-basis step-up on taxable / real-estate accounts.

    Community-property state -> 100% step-up (both halves) regardless of which spouse
    died. Common-law state -> decedent's separate property 100%, jointly-owned 50%
    (only the decedent's half), the survivor's separate property 0%. `owner_map` still
    holds the ORIGINAL owner here (rollover reassignment happens after this call).

    If `plan.merge_basis_at_first_death` is True, ALL taxable-account balances +
    basis are pooled into the survivor's first taxable account after the step-up
    (workbook parity — the spreadsheet keeps only ONE blended-basis taxable line
    post-Y1). Other taxable/real-estate accounts are drained to zero. Real estate
    stays in its own account regardless (blending a personal residence into a
    brokerage doesn't make sense in the workbook or in reality).
    """
    for aid in plan.taxable_ids + plan.other_ids:
        owner = owner_map.get(aid, "Client")
        if plan.community_property:
            frac = 1.0
        elif owner == decedent:
            frac = 1.0
        elif owner == "Joint":
            frac = 0.5
        else:
            frac = 0.0
        cur = basis.get(aid, 0.0)
        if frac > 0 and bal.get(aid, 0.0) > cur:
            basis[aid] = cur + frac * (bal[aid] - cur)

    # Basis merge (workbook convention): after step-up, pool all Taxable
    # accounts into ONE account so subsequent withdrawals draw from a single
    # blended-basis pool. Real estate is preserved separately.
    # The anchor is the SURVIVOR's own taxable account (falling back to a joint
    # account, then to the first): pooling onto `taxable_ids[0]` parked the whole
    # brokerage on the decedent's line — e.g. the balance kept growing on "Client
    # Taxable Brokerage" for years after the client's death.
    if plan.merge_basis_at_first_death and len(plan.taxable_ids) > 1:
        survivor = "Spouse" if decedent == "Client" else "Client"
        orig_owner = {a["id"]: a.get("owner", "Client") for a in plan.accounts}
        anchor = next((aid for aid in plan.taxable_ids if orig_owner.get(aid) == survivor),
                      next((aid for aid in plan.taxable_ids if orig_owner.get(aid) == "Joint"),
                           plan.taxable_ids[0]))
        pooled_bal = sum(bal.get(aid, 0.0) for aid in plan.taxable_ids)
        pooled_basis = sum(basis.get(aid, 0.0) for aid in plan.taxable_ids)
        for aid in plan.taxable_ids:
            bal[aid] = 0.0
            basis[aid] = 0.0
        bal[anchor] = pooled_bal
        basis[anchor] = pooled_basis


def _apply_spousal_rollover(plan, owner_map, basis, bal, client_alive, spouse_alive,
                            client_alive_prev, spouse_alive_prev):
    """The year AFTER first death: step up taxable/real-estate basis (state + ownership
    dependent), then transfer the decedent's accounts to the survivor (all in place)."""
    if not plan.has_spouse:
        return
    if (not client_alive) and client_alive_prev and spouse_alive:
        decedent, survivor = "Client", "Spouse"
    elif (not spouse_alive) and spouse_alive_prev and client_alive:
        decedent, survivor = "Spouse", "Client"
    else:
        return
    _step_up_basis(plan, owner_map, basis, bal, decedent)
    owner_map.update({k: (survivor if v == decedent else v) for k, v in owner_map.items()})
    # Retitle the decedent's RETIREMENT accounts onto the SURVIVOR's own account
    # of the same tax type (advisor request 2026-08-21). Ownership already
    # transferred above — a spousal rollover means the survivor holds the IRA and
    # the Roth — so leaving the dollars on the decedent's account made the
    # year-by-year account table report balances on a dead person's line. Totals,
    # RMD divisors (driven by owner_map + the owner's age) and aggregate basis are
    # unchanged — only which row carries the money.
    # Deliberately limited to Traditional / Roth: Taxable and Real-Estate lots are
    # governed by _step_up_basis and the `merge_basis_at_first_death` flag, and
    # folding them here would silently defeat merge=False (which must keep the
    # stepped-up lot separate so the survivor can spend it first).
    RETITLE_TYPES = ("Tax-Deferred", "Tax-Free")
    by_owner_type = {}
    for a in plan.accounts:
        by_owner_type.setdefault((a.get("owner", "Client"), a.get("tax_type")), []).append(a["id"])
    for a in plan.accounts:
        if a.get("owner", "Client") != decedent or a.get("tax_type") not in RETITLE_TYPES:
            continue
        dst_ids = by_owner_type.get((survivor, a.get("tax_type")))
        if not dst_ids:
            continue                      # survivor holds nothing of this type — leave in place
        dst, src = dst_ids[0], a["id"]
        if dst == src:
            continue
        bal[dst] = bal.get(dst, 0.0) + bal.get(src, 0.0)
        basis[dst] = basis.get(dst, 0.0) + basis.get(src, 0.0)
        bal[src] = 0.0
        basis[src] = 0.0


def _medicare_headcount(plan, client_alive, spouse_alive, year):
    """Count living spouses aged 65+ (Medicare-eligible)."""
    count = 0
    for alive, dob in ((client_alive, plan.client_dob),
                       (spouse_alive, plan.spouse_dob if plan.has_spouse else None)):
        if alive and dob is not None and _age(dob, year) >= 65:
            count += 1
    return count


def _year_demographics(plan: Plan, owner_map: dict, basis: dict, bal: dict, year: int,
                       client_alive_prev: bool, spouse_alive_prev: bool) -> YearStatus:
    """Resolve who is alive, the filing status, the spousal account rollover (with
    first-death basis step-up) and the 65+/Medicare head-counts for one year. Mutates
    `owner_map` and `basis` in place on first death."""
    client_alive = _alive(plan.client_dob, plan.client_death, year)
    spouse_alive = plan.has_spouse and _alive(plan.spouse_dob, plan.spouse_death, year)
    both_alive = client_alive and spouse_alive
    filing = "MFJ" if both_alive else plan.survivor_status
    survivor_owner = (None if both_alive or not plan.has_spouse
                      else ("Client" if client_alive else "Spouse"))

    _apply_spousal_rollover(plan, owner_map, basis, bal, client_alive, spouse_alive,
                            client_alive_prev, spouse_alive_prev)
    count65 = _medicare_headcount(plan, client_alive, spouse_alive, year)

    return YearStatus(client_alive, spouse_alive, both_alive, client_alive or spouse_alive,
                      filing, filing == "MFJ", survivor_owner, count65, count65)


@dataclass
class YearCalc:
    """All computed scalars for one projection year, ready to serialize into a row."""
    tax_res: dict
    bracket_index: float
    irmaa_index: float
    ordinary_non_ss: float
    gross_ss: float
    recurring_div: float
    realized_ltcg: float
    cash_interest: float
    rmd_total: float
    conversion: float
    total_tax: float
    total_expense: float
    cash_drawn: float
    ira_withdraw: float
    roth_withdraw: float
    surplus: float
    wd: dict
    # Line-item breakdowns for the Cashflow tab. Populated in the main loop.
    income_lines: list = field(default_factory=list)
    expense_lines: list = field(default_factory=list)
    rmd_by: dict = field(default_factory=dict)
    taxable_dividends: float = 0.0
    taxable_withdraw: float = 0.0
    # ----- Qualified Charitable Distribution (QCD) values, if any -----
    qcd_total: float = 0.0
    qcd_client: float = 0.0
    qcd_spouse: float = 0.0


def _assemble_line_items(plan, status, calc, tax_res) -> dict:
    """Assemble the full income + expense line-item statement for one year.

    Consumers: the "Cashflow" tab (frontend) renders this directly. Contract:
      - `income` is a list of {source, kind, owner, amount, taxable_ordinary,
        taxable_preferential, note?}. Sum of `amount` == `income_subtotal`.
      - `expenses` is a list of {source, category, owner, amount}. Sum of `amount`
        == `expense_subtotal`.
      - `funding` block splits how the shortfall (if any) was drawn from cash /
        taxable / IRA / Roth.
      - `subtotals` gives the four bold reconciliation numbers the tab renders.
      - `non_cash_events` lists things (Roth conversions) that DRIVE the tax bill
        but are not real cash movements — kept separate so `income_subtotal` isn't
        overstated.
    """
    # ---------- Income ----------
    income: list = []
    for line in calc.income_lines:
        rec = {
            "source": line["source"],
            "owner": line["owner"],
            "kind": line["kind"],
            "amount": line["amount"],
            # Ordinary / preferential contribution of THIS source alone (for the
            # per-year card view). SS is special: only the taxable portion of the
            # aggregate applies proportionally across all SS lines.
        }
        if line["kind"] == "ss":
            gross = calc.gross_ss
            frac = (line["amount"] / gross) if gross > 0 else 0
            rec["taxable_ordinary"] = round(tax_res["taxable_ss"] * frac, 2)
            rec["taxable_preferential"] = 0.0
        elif line["kind"] == "dividends":
            rec["taxable_ordinary"] = 0.0
            rec["taxable_preferential"] = line["amount"]
        else:
            rec["taxable_ordinary"] = line["amount"]
            rec["taxable_preferential"] = 0.0
        income.append(rec)

    # Taxable-brokerage dividends (yield * balance) — synthesized here from `calc`,
    # not from streams. Preferential-taxed.
    if calc.taxable_dividends > 0:
        income.append({
            "source": "Taxable brokerage dividends", "owner": "Joint",
            "kind": "dividends", "amount": calc.taxable_dividends,
            "taxable_ordinary": 0.0, "taxable_preferential": calc.taxable_dividends,
        })

    if calc.cash_interest > 0:
        income.append({
            "source": "Cash interest", "owner": "Joint", "kind": "interest",
            "amount": round(calc.cash_interest, 2),
            "taxable_ordinary": round(calc.cash_interest, 2),
            "taxable_preferential": 0.0,
        })

    if calc.realized_ltcg > 0:
        income.append({
            "source": "Realized LTCG (rebalance)", "owner": "Joint", "kind": "dividends",
            "amount": round(calc.realized_ltcg, 2),
            "taxable_ordinary": 0.0,
            "taxable_preferential": round(calc.realized_ltcg, 2),
            "note": "Long-term gains realized when funding spend / rebalancing.",
        })

    # RMDs per source account — labeled by account name so the couple can see
    # which IRA drove which withdrawal. If QCDs are active, the taxable portion
    # is netted out (QCDs pass to charity untaxed — see the "Charitable — QCD"
    # expense line below).
    qcd_remaining = calc.qcd_total
    for aid, amt in (calc.rmd_by or {}).items():
        if amt <= 0:
            continue
        acct = next((a for a in plan.accounts if a["id"] == aid), None)
        # Apportion QCD against this account's RMD share (proportional split so a
        # multi-IRA household sees each IRA's QCD portion excluded consistently).
        share = amt / calc.rmd_total if calc.rmd_total > 0 else 0.0
        qcd_here = min(qcd_remaining, calc.qcd_total * share)
        qcd_remaining = max(0.0, qcd_remaining - qcd_here)
        taxable_here = max(0.0, amt - qcd_here)
        source = f"RMD — {acct['name'] if acct else aid}"
        if qcd_here > 0:
            source += f" (net of ${round(qcd_here):,.0f} QCD)"
        income.append({
            "source": source,
            "owner": (acct.get("owner") if acct else "Joint"),
            "kind": "rmd",
            "amount": round(amt, 2),                     # gross amount leaving the IRA
            "taxable_ordinary": round(taxable_here, 2),   # taxable portion only
            "taxable_preferential": 0.0,
            "note": (
                "Required minimum distribution — always taxed as ordinary income."
                if qcd_here <= 0 else
                f"Required minimum distribution. ${round(qcd_here):,.0f} routed to charity as a Qualified Charitable Distribution (excluded from AGI)."
            ),
        })

    income_subtotal = round(sum(x["amount"] for x in income), 2)

    # ---------- Expenses ----------
    expenses: list = list(calc.expense_lines)  # copy — we'll append tax/medicare

    # Federal + state tax (rolled together on the same category so the tab can
    # optionally split them via the taxable_ordinary/preferential columns).
    if tax_res.get("federal_ordinary_tax", 0) + tax_res.get("federal_ltcg_tax", 0) > 0:
        expenses.append({
            "source": "Federal income tax", "owner": "Joint",
            "category": "taxes",
            "amount": round(tax_res["federal_ordinary_tax"] + tax_res["federal_ltcg_tax"]
                            + tax_res.get("niit", 0), 2),
        })
    if tax_res.get("state_tax", 0) > 0:
        expenses.append({
            "source": "State income tax", "owner": "Joint", "category": "taxes",
            "amount": round(tax_res["state_tax"], 2),
        })
    if tax_res.get("medicare_premiums", 0) > 0:
        expenses.append({
            "source": "Medicare + IRMAA", "owner": "Joint", "category": "health",
            "amount": round(tax_res["medicare_premiums"], 2),
        })

    # Qualified Charitable Distributions — money routed from IRA to a 501(c)(3).
    # These dollars ARE a real outflow (they leave the household), but they
    # NEVER enter taxable income. Rendered as an expense so the cashflow tab
    # reconciles: income line for the full RMD, expense line for the charity portion.
    if calc.qcd_total > 0:
        expenses.append({
            "source": "Charitable — QCD", "owner": "Joint", "category": "charity",
            "amount": round(calc.qcd_total, 2),
            "note": "Qualified Charitable Distribution from IRA to charity — counts toward RMD, excluded from AGI.",
        })

    expense_subtotal = round(sum(x["amount"] for x in expenses), 2)

    # ---------- Funding block ----------
    funding = {
        "from_cash": round(calc.cash_drawn, 2),
        "from_taxable": calc.taxable_withdraw,
        "from_ira": round(calc.ira_withdraw, 2),
        "from_roth": round(calc.roth_withdraw, 2),
    }
    funding_total = round(sum(funding.values()), 2)

    # ---------- Reconciliation ----------
    net_cashflow = round(income_subtotal - expense_subtotal, 2)
    # Positive surplus = swept back into taxable brokerage; negative = funded by
    # withdrawals (funding_total covers it). The two paths mean net_cashflow +
    # funding_total ≈ surplus (calc.surplus is the ground-truth reconciler).

    return {
        "income": income,
        "expenses": expenses,
        "funding": funding,
        "subtotals": {
            "income": income_subtotal,
            "expenses": expense_subtotal,
            "net_cashflow": net_cashflow,
            "funding_drawn": funding_total,
            "surplus": round(calc.surplus, 2),
        },
        "non_cash_events": (
            [{"source": "Roth conversion", "kind": "conversion",
              "amount": round(calc.conversion, 2),
              "note": "Not a real cashflow — drives the tax bill only. IRA → Roth transfer."}]
            if calc.conversion > 0 else []
        ),
    }


def _build_year_row(plan: Plan, status: YearStatus, year: int, bal: dict, calc: YearCalc) -> dict:
    """Serialize one year's end-of-year state into the projection row dict."""
    tax_res = calc.tax_res
    cash_ids, taxable_ids = plan.cash_ids, plan.taxable_ids
    ira_ids, roth_ids, other_ids = plan.ira_ids, plan.roth_ids, plan.other_ids
    liquid = sum(bal[i] for i in cash_ids + taxable_ids + ira_ids + roth_ids)
    net_worth = liquid + sum(bal[i] for i in other_ids)
    # Effective per-year target rate (phased schedules override the flat target).
    year_target = plan.year_targets.get(year, plan.target_rate)
    tgt_ceiling = bracket_ceiling(year_target, status.mfj, calc.bracket_index)
    # `ordinary_taxable_income` already includes the year's conversion. Unused
    # headroom = dollars the plan could still have converted at the target rate
    # without pushing into the next bracket — advisors visualize this as a
    # faint bar behind each conversion so they can see where the plan left
    # room versus where it filled the bracket.
    unused_headroom = max(0.0, (tgt_ceiling - tax_res["ordinary_taxable_income"])) if tgt_ceiling != float("inf") else 0.0
    return {
        "year": year,
        "filing_status": status.filing,
        "client_age": _age(plan.client_dob, year) if status.client_alive else None,
        "spouse_age": _age(plan.spouse_dob, year) if (plan.has_spouse and status.spouse_alive) else None,
        # ordinary_income is what enters the ordinary tax bracket → EXCLUDES QCD portion of RMD.
        "ordinary_income": round(calc.ordinary_non_ss + max(0.0, calc.rmd_total - calc.qcd_total) + calc.cash_interest, 2),
        "rmd": round(calc.rmd_total, 2),
        "qcd": round(calc.qcd_total, 2),
        "qcd_by_owner": {"Client": round(calc.qcd_client, 2), "Spouse": round(calc.qcd_spouse, 2)},
        "roth_conversion": round(calc.conversion, 2),
        "preferential_income": round(calc.recurring_div + calc.realized_ltcg, 2),
        "gross_ss": round(calc.gross_ss, 2),
        "taxable_income": tax_res["taxable_income"],
        "total_tax": round(calc.total_tax, 2),
        "effective_rate": tax_res["effective_rate"],
        "marginal_rate": tax_res["marginal_ordinary_rate"],
        "ordinary_taxable_income": tax_res["ordinary_taxable_income"],
        "magi": tax_res["magi"],
        "irmaa_magi": tax_res["irmaa_magi"],
        "irmaa_tier": tax_res["irmaa_tier"],
        "irmaa_thresholds": irmaa_thresholds(status.mfj, calc.irmaa_index),
        "bracket_fill": bracket_fill(tax_res["ordinary_taxable_income"], status.mfj, calc.bracket_index),
        # Indexation multiplier applied to the federal bracket floors this year.
        # Exposed so the frontend Tax Bracket Visualizer can draw the "bucket"
        # boundaries without re-running the tax engine — bracket_edge_this_year
        # = base_floor * bracket_index.
        "bracket_index": round(calc.bracket_index, 6),
        # Bracket-fill headroom info for the ConversionScheduleChart overlay.
        # `target_bracket_ceiling`: dollar top of the target bracket in this
        # year (`None` when target = top marginal, i.e. no ceiling).
        # `conversion_headroom_unused`: dollars the plan LEFT ON THE TABLE at
        # the target rate — the "room to ceiling" visualization.
        "target_bracket_ceiling": None if tgt_ceiling == float("inf") else round(tgt_ceiling, 2),
        "conversion_headroom_unused": round(unused_headroom, 2),
        "tax_breakdown": {
            "ordinary": tax_res["federal_ordinary_tax"],
            "preferential": tax_res["federal_ltcg_tax"],
            "niit": tax_res["niit"],
            "state": tax_res["state_tax"],
            "medicare": tax_res["medicare_premiums"],
        },
        # Full per-year tax detail powering the Tax Detail tab. Everything here is
        # ALREADY computed by tax_engine.compute_year_tax — this is exposure of
        # intermediates, not new math. Callout flags (IRMAA step change, LTCG
        # bump-zone crossing, SS Torpedo step) are diffed year-over-year on the
        # frontend so the backend row stays stateless.
        "tax_detail": {
            "preferential_taxable": tax_res["preferential_within_taxable"],
            "total_preferential": tax_res["total_preferential"],
            "taxable_ss": tax_res["taxable_ss"],
            "provisional_income": tax_res["provisional_income"],
            "standard_deduction": tax_res["standard_deduction"],
            "senior_bonus": tax_res["senior_bonus"],
            # SS Torpedo indicator: what % of gross SS ended up federally taxable
            # (0 / 50 / 85, or an in-between number when partly across a phase-in).
            # None when the household received no SS this year.
            "ss_inclusion_pct": (
                round(tax_res["taxable_ss"] / calc.gross_ss * 100, 2)
                if calc.gross_ss > 0 else None
            ),
            # How preferential dollars stack across the 0/15/20% LTCG bands plus
            # the indexed ceilings that draw the cliffs — the Bump-Zone Alert
            # feeds off these numbers.
            "ltcg_band_split": ltcg_band_split(
                tax_res["ordinary_taxable_income"],
                tax_res["preferential_within_taxable"],
                status.mfj, calc.bracket_index),
            # Marginal effective rate on the LAST dollar of ordinary income.
            # Same as `marginal_rate` above until SS/IRMAA/LTCG interactions
            # kick in; kept alongside for callout tooling.
            "marginal_ordinary_rate": tax_res["marginal_ordinary_rate"],
            "effective_rate": tax_res["effective_rate"],
            # Per-state tax detail (real state engine when scenario.tax.state_code
            # is set, else legacy `state_rate × federal_taxable` fallback).
            "state_detail": tax_res.get("state_detail", {}),
        },
        "cash": round(sum(bal[i] for i in cash_ids), 2),
        "taxable": round(sum(bal[i] for i in taxable_ids), 2),
        "traditional": round(sum(bal[i] for i in ira_ids), 2),
        "roth": round(sum(bal[i] for i in roth_ids), 2),
        "real_estate": round(sum(bal[i] for i in other_ids), 2),
        "net_worth": round(net_worth, 2),
        # per-account end-of-year balances (for the Account Detail view)
        "account_balances": {aid: round(bal[aid], 2)
                             for aid in (cash_ids + taxable_ids + ira_ids + roth_ids + other_ids)},
        # year-by-year cashflow line items (mirrors the spreadsheet CashFlow sheet)
        "cashflow": {
            "wages_pension": round(calc.ordinary_non_ss, 2),
            "gross_ss": round(calc.gross_ss, 2),
            "taxable_ss": tax_res["taxable_ss"],
            "dividends": round(calc.recurring_div, 2),
            "interest": round(calc.cash_interest, 2),
            "rmd": round(calc.rmd_total, 2),
            "qcd": round(calc.qcd_total, 2),
            "conversion": round(calc.conversion, 2),
            "expenses": round(calc.total_expense, 2),
            "income_tax": tax_res["total_income_tax"],
            "medicare": tax_res["medicare_premiums"],
            "from_cash": round(calc.cash_drawn, 2),
            "from_taxable": round(sum(v for k, v in calc.wd.items() if k in plan.taxable_set), 2),
            "from_ira": round(calc.ira_withdraw, 2),
            "from_roth": round(calc.roth_withdraw, 2),
            "surplus": round(calc.surplus, 2),
        },
        # Full per-year income + expense statement powering the Cashflow tab.
        # Assembled from the same intermediates the aggregate cashflow uses so
        # every subtotal reconciles to the row's aggregates to the cent.
        "line_items": _assemble_line_items(plan, status, calc, tax_res),
    }


def run_projection(cfg: dict) -> dict:
    # Apply Market Scenario overrides (if any). This is a no-op when
    # cfg.market_scenario is absent, id == "custom", or id is unknown — so
    # historical_avg / default plans keep the exact V17-aligned outputs.
    cfg = apply_market_scenario(cfg)
    plan = _parse_plan(cfg)

    # mutable balances
    bal = {a["id"]: a["beginning_balance"] for a in plan.accounts}
    basis = {a["id"]: a.get("cost_basis", 0.0) for a in plan.accounts}
    owner_map = {a["id"]: a.get("owner", "Client") for a in plan.accounts}  # reassigned at first death

    magi_history = {}  # year -> MAGI, for the IRMAA 2-year lookback
    client_alive_prev, spouse_alive_prev = True, plan.has_spouse
    rows = []
    # Lifetime-giving pot: cumulative gifted dollars compounded at the heir
    # reinvestment rate (falls back to taxable_return). Tracked separately so
    # it appears as a bonus family delta at Y2+10 without polluting NW.
    lc = plan.cfg.get("legacy", {}) or {}
    _giving_growth = lc.get("heir_reinvest_return")
    if _giving_growth is None:
        _giving_growth = next((a["return"] for a in plan.accounts if a["tax_type"] == "Taxable"), 0.06)
    gift_pot = 0.0
    gift_pot_basis = 0.0  # §1015 carryover basis that traveled with gifted assets
    gift_pot_by_year = {}  # year -> {contributed, cumulative_pot} for the frontend
    # Taxable lifetime gifts (§2001(b)): cumulative adjusted taxable gifts per donor
    # + a per-year ledger for the reporting stage.
    adj_gifts_by_donor = {"Client": 0.0, "Spouse": 0.0}
    taxable_gift_rows = []
    # 5-year/pre-59½ compliance tracking — per-conversion basis (Roth ordering rules):
    #   (1) each conversion has its own 5-yr clock (10% penalty on conversion principal
    #       tapped early),
    #   (2) earnings withdrawn before the OWNER's account-first-contribution 5yr clock
    #       AND before age 59½ are taxable + 10% penalty.
    # We approximate at the household level: any Roth withdrawal that would tap a
    # conversion less than 5 years old, OR occur before the primary owner turns 59½,
    # generates a `roth_early_warning` row.
    conversions_ledger = []  # list of {year, amount, remaining, owner_age_at_conversion}
    roth_warnings = []

    for year in range(plan.start_year, plan.end_year + 1):
        yr_off = year - plan.start_year
        bracket_index = (1 + plan.bracket_index_rate) ** yr_off
        irmaa_index = (1 + plan.irmaa_index_rate) ** yr_off

        status = _year_demographics(plan, owner_map, basis, bal, year, client_alive_prev, spouse_alive_prev)
        if not status.anyone_alive:
            break

        # --- income streams ---
        ordinary_non_ss, gross_ss, recurring_div, pension_income = _aggregate_income(
            plan.streams, year, status.client_alive, status.spouse_alive,
            status.both_alive, plan.has_spouse, status.survivor_owner)

        # --- RMDs ---
        rmd_total, rmd_by = _total_rmd(plan, status, owner_map, bal, year)
        qcd_total, qcd_client, qcd_spouse = _qcd_for_year(plan, status, year, rmd_total)

        cash_boy = sum(bal[i] for i in plan.cash_ids)
        cash_interest = cash_boy * plan.cash_rate

        # Taxable-account dividends: paid out as cash income each year, taxed at
        # qualified-dividend / LTCG (preferential) rates. The account itself
        # appreciates at (gross return − dividend yield), so dividends do NOT
        # compound inside the account — only the appreciation does (step-up at death).
        taxable_dividends = sum(bal[i] for i in plan.taxable_ids) * plan.div_yield
        recurring_div += taxable_dividends

        # --- Roth conversion window (fill-the-bracket, sized inside the circular loop) ---
        ira_balance = sum(bal[i] for i in plan.ira_ids)
        in_window = plan.roth_enabled and plan.conv_start <= year <= plan.conv_end and ira_balance > 0
        if plan.stop_at_rmd and _age(plan.client_dob, year) >= rmd_start_age(plan.client_dob):
            in_window = False
        # per-year target bracket (phased schedules override the flat target_rate)
        year_target = plan.year_targets.get(year, plan.target_rate)
        if year_target is not None and year_target <= 0:
            in_window = False       # a 0 bracket disables conversions that year
        irmaa_index_yplus2 = (1 + plan.irmaa_index_rate) ** (yr_off + IRMAA_LOOKBACK_YEARS)

        # --- expenses ---
        total_expense = _total_expenses(
            plan.expenses, year, status.client_alive, status.spouse_alive,
            status.both_alive, plan.start_year, plan.survivor_spending_reduction)

        # Older-spouse age drives age-gated retirement-income exclusions in some states.
        _client_age_now = _age(plan.client_dob, year) if status.client_alive else 0
        _spouse_age_now = (_age(plan.spouse_dob, year) if (plan.has_spouse and status.spouse_alive) else 0)
        max_age = max(_client_age_now, _spouse_age_now)

        # --- circular solve: conversion <-> discretionary IRA withdrawal <-> taxes ---
        eff_state = _effective_state_code(plan.state_code, plan.state_move, year)
        tax_base = {
            "filing_status": status.filing, "year": year,
            "bracket_index": bracket_index, "irmaa_index": irmaa_index,
            "num_65plus": status.num65, "medicare_count": status.med_count,
            "ordinary_non_ss": ordinary_non_ss, "cash_interest": cash_interest,
            "gross_ss": gross_ss, "recurring_div_ltcg": recurring_div,
            "state_rate": plan.state_rate, "state_code": eff_state,
            "pension_income": pension_income, "max_age": max_age,
            "include_irmaa": plan.include_irmaa,
        }
        ctx = _SolveCtx(
            tax_base=tax_base, in_window=in_window, target_rate=year_target,
            max_annual=plan.max_annual, irmaa_cap=plan.irmaa_cap, mfj=status.mfj,
            irmaa_index_yplus2=irmaa_index_yplus2,
            irmaa_magi=magi_history.get(year - IRMAA_LOOKBACK_YEARS),  # 2-yr lookback
            rmd_total=rmd_total, rmd_by=rmd_by, cash_boy=cash_boy, total_expense=total_expense,
            ira_balance=ira_balance, plan=plan, qcd_total=qcd_total)
        conversion, tax_res, wd, realized_ltcg, ira_withdraw, roth_withdraw, basis_consumed = \
            _solve_year_conversion(ctx, bal, basis)
        total_tax = tax_res["total_burden"]

        # 5-year / pre-59½ compliance tracking — PER-OWNER (client vs spouse):
        # A conversion is attributed to the source-IRA's owner (their Roth clock).
        # A Roth withdrawal is attributed to the source-Roth-account's owner (their age).
        client_age = _age(plan.client_dob, year)
        spouse_age = (_age(plan.spouse_dob, year) if plan.has_spouse else None)
        conv_deposits = {}
        if conversion > 0:
            # Attribute per-source-IRA (drain client IRA first, then spouse — matches
            # _apply_year_flows drain order after RMDs come out first). Each owner's
            # converted dollars are physically routed to THEIR OWN Roth account.
            roth_by_owner = {}
            for rid in plan.roth_ids:
                roth_by_owner.setdefault(owner_map.get(rid, "Client"), rid)
            default_roth = plan.roth_ids[0] if plan.roth_ids else None
            rem_conv = conversion
            for iid in plan.ira_ids:
                if rem_conv <= 0:
                    break
                r = next((a["return"] for a in plan.accounts if a["id"] == iid), 0.0)
                grown_after_rmd = max(0.0, bal[iid] * (1 + r) - rmd_by.get(iid, 0.0))
                take = min(rem_conv, grown_after_rmd)
                if take <= 0:
                    continue
                src_owner = owner_map.get(iid, "Client")
                owner_age_at_conv = client_age if src_owner == "Client" else (spouse_age or client_age)
                conversions_ledger.append({
                    "year": year, "owner": src_owner, "amount": round(take, 2),
                    "remaining": round(take, 2), "owner_age_at_conversion": owner_age_at_conv,
                })
                target = roth_by_owner.get(src_owner, default_roth)
                if target is not None:
                    conv_deposits[target] = conv_deposits.get(target, 0.0) + take
                rem_conv -= take
            # residual (source balances thinner than the solved conversion): default Roth
            if rem_conv > 1e-9 and default_roth is not None:
                conv_deposits[default_roth] = conv_deposits.get(default_roth, 0.0) + rem_conv
        if roth_withdraw > 0:
            # Attribute per-Roth-account withdrawal (mirrors _apply_year_flows drain
            # order: acct["roth"] list — typically ROTC (client) before ROTS (spouse)).
            rem_wd_total = roth_withdraw
            per_roth_wd = {}
            for rid in plan.roth_ids:
                if rem_wd_total <= 0:
                    break
                r = next((a["return"] for a in plan.accounts if a["id"] == rid), 0.0)
                grown = bal[rid] * (1 + r)
                take = min(rem_wd_total, grown)
                if take > 0:
                    per_roth_wd[rid] = take
                    rem_wd_total -= take
            for rid, wd_from_rid in per_roth_wd.items():
                rid_owner = owner_map.get(rid, "Client")
                rid_owner_age = client_age if rid_owner == "Client" else (spouse_age if spouse_age is not None else 200)
                # Consume the ledger entries owned by rid_owner, oldest-first.
                rem = wd_from_rid
                violating = 0.0
                for lot in conversions_ledger:
                    if rem <= 0:
                        break
                    if lot.get("owner") != rid_owner or lot["remaining"] <= 0:
                        continue
                    take = min(rem, lot["remaining"])
                    lot["remaining"] -= take
                    rem -= take
                    lot_age = year - lot["year"]
                    if lot_age < 5 and rid_owner_age < 60:
                        violating += take
                if violating > 0:
                    roth_warnings.append({
                        "year": year, "owner": rid_owner, "roth_account": rid,
                        "roth_withdrawn": round(wd_from_rid, 2),
                        "amount_within_5yr": round(violating, 2),
                        "owner_age": rid_owner_age,
                        "client_age": client_age, "spouse_age": spouse_age,
                        "penalty_10pct": round(violating * 0.10, 2),
                        "reason": ("5-year rule + pre-59½: 10% penalty on early conversion principal"
                                   if rid_owner_age < 60 else "5-year rule breach on conversion principal"),
                    })
                elif rid_owner_age < 60:
                    # Pre-59½ withdrawal even without a 5-yr breach — earnings portion
                    # is conservatively flagged (approximation; principal is always
                    # tax + penalty free after 5 yrs).
                    roth_warnings.append({
                        "year": year, "owner": rid_owner, "roth_account": rid,
                        "roth_withdrawn": round(wd_from_rid, 2),
                        "amount_within_5yr": 0.0,
                        "owner_age": rid_owner_age,
                        "client_age": client_age, "spouse_age": spouse_age,
                        "penalty_10pct": round(wd_from_rid * 0.10, 2),
                        "reason": "Pre-59½ Roth withdrawal — earnings portion subject to 10% penalty",
                    })

        magi_history[year] = tax_res["magi"]  # record for future-year IRMAA lookback

        spend_need = total_expense + total_tax
        funding_income = ordinary_non_ss + gross_ss + recurring_div + max(0.0, rmd_total - qcd_total)
        cash_need = spend_need - funding_income           # income covers spending first
        cash_drawn = min(cash_boy, max(0.0, cash_need))
        surplus = funding_income - spend_need
        # grow BOY balances first, then apply year-end flows (matches the sheet's
        # EOY = BOY×(1+r) ± flows convention; current-year flows do not compound)
        _grow_balances(bal, plan.accounts, plan.div_yield, _equity_for_year(plan, year))
        flows = YearFlows(cash_need=cash_need, rmd_by=rmd_by, ira_draw=conversion + ira_withdraw,
                          wd=wd, roth_withdraw=roth_withdraw, conversion=conversion, surplus=surplus,
                          conv_deposits=conv_deposits, basis_consumed=basis_consumed)
        _apply_year_flows(plan, bal, basis, flows, status)

        # --- Lifetime giving program (§2503(b) annual exclusion + §2503(e)) ---
        # Drain the taxable-brokerage anchor account by the gifted amount (both
        # spouses combined) and add it to the family "gift pot" that compounds
        # at the heir reinvestment rate. Only runs during [gift_start, gift_end]
        # AND while at least one spouse is alive.
        gift_pot *= (1.0 + _giving_growth)                       # grow existing pot
        gift_contrib_this_year = 0.0
        _gs = plan.gift_start_year or plan.start_year
        _ge = plan.gift_end_year or plan.end_year
        if (_gs <= year <= _ge) and (plan.annual_gift_amount + plan.section_2503e_amount > 0):
            total_gift = plan.annual_gift_amount + plan.section_2503e_amount
            # Withdraw from Taxable brokerages (cap at available balance across
            # taxable accounts). Consumes basis proportionally (identical mech
            # to `_withdraw` — a gift is a "sale then transfer" from the estate's
            # perspective, and heirs receive stepped-down basis on cash gifts).
            available_tax = sum(bal.get(aid, 0.0) for aid in plan.taxable_ids)
            actual_gift = min(total_gift, available_tax)
            if actual_gift > 0:
                for aid in plan.taxable_ids:
                    if actual_gift <= 0:
                        break
                    take = min(actual_gift, bal.get(aid, 0.0))
                    if take <= 0:
                        continue
                    # Reduce basis pro-rata just like a taxable sale; the consumed
                    # basis travels with the gift under §1015 (carryover basis).
                    if bal.get(aid, 0.0) > 0:
                        b_frac = min(1.0, basis.get(aid, 0.0) / bal[aid])
                        gift_pot_basis += take * b_frac
                        basis[aid] = max(0.0, basis.get(aid, 0.0) - take * b_frac)
                    bal[aid] = max(0.0, bal.get(aid, 0.0) - take)
                    actual_gift -= take
                contributed = min(total_gift, available_tax)
                gift_pot += contributed
                gift_contrib_this_year = contributed
        # --- Taxable lifetime gifts (§2001(b) unified transfer-tax mechanics) ---
        # Gifts above the annual exclusion: drain the donor's Taxable (then Cash)
        # balance, accumulate the donor's cumulative adjusted taxable gift, and add
        # the gifted principal to the family gift pot (it left the estate but stays
        # in the family). A dead donor cannot gift (Joint needs at least one alive).
        for g in plan.taxable_gifts:
            if g["year"] != year:
                continue
            donor = g["donor"]
            donor_can_gift = (
                (donor == "Client" and status.client_alive)
                or (donor == "Spouse" and status.spouse_alive)
                or (donor == "Joint" and (status.client_alive or status.spouse_alive))
            )
            if not donor_can_gift:
                continue
            unfunded, carryover_basis = _drain_for_gift(plan, bal, basis, g["amount"], donor)
            contributed = g["amount"] - unfunded
            if contributed <= 0:
                continue
            gift_pot_basis += carryover_basis
            if donor == "Joint":
                adj_gifts_by_donor["Client"] += contributed / 2.0
                adj_gifts_by_donor["Spouse"] += contributed / 2.0
            else:
                adj_gifts_by_donor[donor] += contributed
            gift_pot += contributed
            gift_contrib_this_year += contributed
            taxable_gift_rows.append(
                {"year": year, "donor": donor, "amount": round(contributed, 2)})
        gift_pot_by_year[year] = {
            "contributed": round(gift_contrib_this_year, 2),
            "cumulative_pot": round(gift_pot, 2),
        }

        # Line-item breakdowns for the Cashflow tab. Same math the aggregates
        # use, exposed one row per source. Cheap: same helper walks a small list.
        income_lines = _income_line_items(
            plan.streams, year, status.client_alive, status.spouse_alive,
            status.both_alive, plan.has_spouse, status.survivor_owner)
        expense_lines = _expense_line_items(
            plan.expenses, year, status.client_alive, status.spouse_alive,
            status.both_alive, plan.start_year, plan.survivor_spending_reduction)

        # Taxable-account withdrawals routed through the plan's `taxable_set`
        # accounts — kept separate from `ira_withdraw` / `roth_withdraw` so the
        # cashflow view can label the funding source correctly per year.
        taxable_wd = round(sum(v for k, v in wd.items() if k in plan.taxable_set), 2)

        calc = YearCalc(
            tax_res=tax_res, bracket_index=bracket_index, irmaa_index=irmaa_index,
            ordinary_non_ss=ordinary_non_ss, gross_ss=gross_ss, recurring_div=recurring_div,
            realized_ltcg=realized_ltcg, cash_interest=cash_interest, rmd_total=rmd_total,
            conversion=conversion, total_tax=total_tax, total_expense=total_expense,
            cash_drawn=cash_drawn, ira_withdraw=ira_withdraw, roth_withdraw=roth_withdraw,
            surplus=surplus, wd=wd,
            income_lines=income_lines, expense_lines=expense_lines,
            rmd_by=rmd_by, taxable_dividends=round(taxable_dividends, 2),
            taxable_withdraw=taxable_wd,
            qcd_total=qcd_total, qcd_client=qcd_client, qcd_spouse=qcd_spouse)
        rows.append(_build_year_row(plan, status, year, bal, calc))

        client_alive_prev, spouse_alive_prev = status.client_alive, status.spouse_alive

    # Build the taxable-gifts summary (empty -> None so the result stays byte-
    # identical to pre-gift behavior; the golden baseline has no taxable gifts).
    _tg_summary = None
    if taxable_gift_rows:
        first_adj, second_adj = _split_adjusted_gifts(plan, adj_gifts_by_donor)
        _tg_summary = {
            "by_donor": {"Client": round(adj_gifts_by_donor["Client"], 2),
                         "Spouse": round(adj_gifts_by_donor["Spouse"], 2)},
            "first_decedent": _first_decedent_donor(plan),
            "adjusted_gifts_first_death": first_adj,
            "adjusted_gifts_second_death": second_adj,
            "total": round(adj_gifts_by_donor["Client"] + adj_gifts_by_donor["Spouse"], 2),
            "rows": taxable_gift_rows,
        }
    result = _aggregate_results(cfg, rows, warnings=roth_warnings, ledger=conversions_ledger,
                                auto_accounts=plan.auto_accounts, accounts=plan.accounts,
                                gift_pot_by_year=gift_pot_by_year,
                                taxable_gifts_summary=_tg_summary,
                                gift_pot_basis=gift_pot_basis)
    # Surface the ending taxable cost basis (already tracked internally, incl. any
    # first-death §1014 step-up) so callers can derive the embedded unrealized gain
    # in the taxable account at end of plan. Additive only — no calc change.
    result.setdefault("summary", {})["ending_taxable_basis"] = round(
        sum(basis.get(aid, 0.0) for aid in plan.taxable_ids), 2)
    return result


def sweep_brackets(cfg: dict) -> dict:
    """Run the projection for each candidate target bracket (+ no-conversion) and
    rank by lifetime taxes and after-tax estate to heirs. Phase 9 auto-optimizer."""
    import copy
    candidates = [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37]
    results = []

    # baseline: conversions disabled
    base_cfg = copy.deepcopy(cfg)
    base_cfg["roth"]["enabled"] = False
    base = run_projection(base_cfg)
    results.append({
        "label": "No conversions",
        "target_bracket": None,
        "lifetime_taxes": base["summary"]["lifetime_taxes"],
        "ending_net_worth": base["summary"]["ending_net_worth"],
        "ending_roth": base["summary"]["ending_roth"],
        "total_converted": 0.0,
        "after_tax_estate": base["legacy"]["after_tax_estate_to_heirs"],
    })

    for rate in candidates:
        c = copy.deepcopy(cfg)
        c["roth"]["enabled"] = True
        c["roth"]["target_bracket"] = rate
        r = run_projection(c)
        results.append({
            "label": f"Fill {int(rate*100)}% bracket",
            "target_bracket": rate,
            "lifetime_taxes": r["summary"]["lifetime_taxes"],
            "ending_net_worth": r["summary"]["ending_net_worth"],
            "ending_roth": r["summary"]["ending_roth"],
            "total_converted": r["summary"]["total_roth_converted"],
            "after_tax_estate": r["legacy"]["after_tax_estate_to_heirs"],
        })

    # rank by highest after-tax estate; tie-break on lower lifetime taxes
    ranked = sorted(results, key=lambda x: (-x["after_tax_estate"], x["lifetime_taxes"]))
    best = ranked[0]
    return {
        "results": results,
        "ranked": ranked,
        "best": best,
        "metric": "after_tax_estate_to_heirs",
    }


# Beneficiary combined ordinary marginal rates for the Legacy-page sensitivity.
# The heir rate is an ASSUMPTION about people whose careers and tax brackets
# cannot be forecast decades out, so the report shows the after-tax inheritance
# across a low / middle / high band instead of one presumed future.
DEFAULT_HEIR_SENS_RATES = (0.14, 0.26, 0.41)


# ---------------------------------------------------------------------------
# Present-value helpers — the SINGLE shared discount path for every comparison
# surface. The published methodology commits to reporting today's dollars beside
# every nominal headline delta; discounting each figure from the year it occurs
# back to the plan start year at the model's inflation assumption is the
# apples-to-apples measure across strategies that shift tax into different
# decades. Every comparison endpoint routes its discounting through these.
# ---------------------------------------------------------------------------
def plan_discount_rate(cfg: dict, override=None) -> float:
    """The discount rate for present-value figures: the plan's own general
    inflation assumption unless an explicit override is supplied."""
    if override is not None:
        try:
            return float(override)
        except (TypeError, ValueError):
            pass
    return (cfg.get("projection", {}) or {}).get("general_inflation", 0.03) or 0.03


def plan_start_year(cfg: dict, rows: list | None = None) -> int:
    proj = cfg.get("projection", {}) or {}
    if proj.get("start_year") is not None:
        return proj["start_year"]
    return rows[0]["year"] if rows else 0


def discount_factor(year, start, rate: float) -> float:
    """1 / (1+rate)^(year-start); 1.0 when `year` is unknown or precedes start."""
    if year is None:
        return 1.0
    return 1.0 / ((1.0 + rate) ** max(0, (year - start)))


def present_value(value, year, start, rate: float) -> float:
    """Discount `value` occurring in `year` back to `start` at `rate`."""
    return (value or 0.0) * discount_factor(year, start, rate)


def lifetime_tax_present_value(rows: list, start, rate: float) -> float:
    """NPV of each year's total_tax discounted back to the plan start year."""
    total = 0.0
    for row in rows or []:
        yr = row.get("year", start)
        total += (row.get("total_tax", 0) or 0) / ((1.0 + rate) ** max(0, (yr - start)))
    return total


def heir_rate_sensitivity(cfg: dict, rates=None) -> dict:
    """After-tax inheritance under alternative beneficiary marginal rates.

    The heir ordinary rate feeds ONLY the post-death SECURE-10 horizon, never the
    parents' cash-flow/tax projection — so each branch (with / without conversions)
    projects once and the heir horizon is re-priced per candidate rate.
    """
    import copy

    clean = []
    for r in (rates or DEFAULT_HEIR_SENS_RATES):
        try:
            v = round(float(r), 4)
        except (TypeError, ValueError):
            continue
        if 0.0 <= v <= 0.6:
            clean.append(v)
    rate_list = sorted(set(clean)) or list(DEFAULT_HEIR_SENS_RATES)

    lc = cfg.get("legacy", {}) or {}
    if "heir_federal_rate" in lc or "heir_state_rate" in lc:
        modeled = round((lc.get("heir_federal_rate") or 0.0) + (lc.get("heir_state_rate") or 0.0), 4)
    else:
        modeled = round(lc.get("heir_ordinary_rate", 0.30), 4)
    all_rates = sorted(set(rate_list + [modeled]))

    start = plan_start_year(cfg)
    disc = plan_discount_rate(cfg)
    _, second = _fo_death_years(cfg)
    horizon = int((cfg.get("legacy", {}) or {}).get("post_death_years", 10) or 10)
    deliver_year = (second + horizon) if second else None
    f_deliver = discount_factor(deliver_year, start, disc)

    out = {"modeled_rate": modeled, "rates": all_rates, "branches": {}, "lifetime_taxes": {},
           "start_year": start, "discount_rate": round(disc, 4), "heir_deliver_year": deliver_year}
    for key, roth_on in (("with_conversions", True), ("no_conversions", False)):
        c = apply_market_scenario(copy.deepcopy(cfg))
        if not roth_on:
            c.setdefault("roth", {})["enabled"] = False
        res = run_projection(c)
        final = res["rows"][-1] if res.get("rows") else {}
        accounts = _parse_plan(c).accounts
        entries = []
        for r in all_rates:
            cm = copy.deepcopy(c)
            leg_cfg = cm.setdefault("legacy", {})
            leg_cfg["heir_federal_rate"] = r
            leg_cfg["heir_state_rate"] = 0.0
            leg_cfg["heir_ltcg_rate"] = lc.get("heir_ltcg_rate", 0.228)
            leg = _compute_legacy(cm, final, accounts=accounts)
            entries.append({
                "rate": r,
                "is_modeled": abs(r - modeled) < 1e-9,
                "after_tax_estate_to_heirs": leg["after_tax_estate_to_heirs"],
                "after_tax_estate_to_heirs_today": round(leg["after_tax_estate_to_heirs"] * f_deliver, 2),
                "inherited_ira_tax": leg["inherited_ira_tax"],
                "tax_free_roth_to_heirs": leg["tax_free_roth_to_heirs"],
            })
        out["branches"][key] = entries
        out["lifetime_taxes"][key] = res["summary"]["lifetime_taxes"]
    return out


# Extra years of SURVIVOR life expectancy tested by the longevity trade-off grid.
# Negative rows matter as much as positive ones: early mortality favours keeping
# the taxable brokerage for the §1014 step-up, long survival favours a bigger Roth.
DEFAULT_LONGEVITY_DELTAS = (-10, -5, 0, 5, 10, 20)
LONGEVITY_ORDERS = (
    "Cash → Taxable → IRA → Roth",
    "Cash → IRA → Taxable → Roth",
    "Split IRA & Taxable",
)


def funding_order_longevity(cfg: dict, deltas=None, orders=None) -> dict:
    """Funding-order trade-off as the SURVIVING spouse lives longer.

    Taxable-first funding preserves the pre-tax IRA (more conversion room, but a
    bigger SECURE-10 exposure); IRA-first spends it down and preserves the taxable
    brokerage for the §1014 step-up. Which side leads is largely a longevity bet —
    more surviving years means more tax-free Roth compounding. This grid runs the
    SAME conversion strategy at several survivor life expectancies so the advisor
    can show the flip instead of asserting it.
    """
    import copy

    clean = []
    for d in (deltas or DEFAULT_LONGEVITY_DELTAS):
        try:
            v = int(d)
        except (TypeError, ValueError):
            continue
        if -15 <= v <= 30:
            clean.append(v)
    delta_list = sorted(set(clean)) or list(DEFAULT_LONGEVITY_DELTAS)
    if 0 not in delta_list:
        delta_list = sorted(delta_list + [0])
    order_list = [o for o in (orders or LONGEVITY_ORDERS) if o in LONGEVITY_ORDERS] or list(LONGEVITY_ORDERS)

    h = cfg.get("household", {}) or {}
    client_death_year = (h.get("client_dob_year") or 0) + (h.get("client_life_expectancy") or 0)
    spouse_death_year = (h.get("spouse_dob_year") or 0) + (h.get("spouse_life_expectancy") or 0)
    survivor = "spouse" if spouse_death_year >= client_death_year else "client"
    le_key = "spouse_life_expectancy" if survivor == "spouse" else "client_life_expectancy"
    base_second_death = max(client_death_year, spouse_death_year)
    start_year = (cfg.get("projection", {}) or {}).get("start_year") or 0
    first_death = min(client_death_year, spouse_death_year)

    rows = []
    for d in delta_list:
        second_death = base_second_death + d
        # Never let the survivor "die" before the first death or before the plan
        # has run a year — those grids are meaningless, so the row is skipped.
        if second_death <= max(start_year + 1, first_death):
            continue
        base = apply_market_scenario(copy.deepcopy(cfg))
        hh = base.setdefault("household", {})
        hh[le_key] = (hh.get(le_key) or 0) + d
        # The projection horizon tracks the second death in BOTH directions so a
        # shorter life isn't padded with post-death years.
        base.setdefault("projection", {})["end_year"] = second_death
        per_order = {}
        for order in order_list:
            c = copy.deepcopy(base)
            c.setdefault("withdrawal", {})["funding_order"] = order
            res = run_projection(c)
            final = res["rows"][-1] if res.get("rows") else {}
            per_order[order] = {
                "after_tax_estate": res["legacy"]["after_tax_estate_to_heirs"],
                "lifetime_taxes": res["summary"]["lifetime_taxes"],
                "total_converted": res["summary"]["total_roth_converted"],
                "ending_roth": res["summary"]["ending_roth"],
                "ending_taxable": final.get("taxable", 0.0),
                "ending_traditional": final.get("traditional", 0.0),
            }
        leader = max(per_order.items(),
                     key=lambda kv: (kv[1]["after_tax_estate"], -kv[1]["lifetime_taxes"]))[0]
        rows.append({
            "extra_years": d,
            "second_death_year": second_death,
            "survivor_age_at_death": (hh.get(le_key) or 0),
            "orders": per_order,
            "leader": leader,
        })

    return {
        "survivor": survivor,
        "orders": order_list,
        "baseline_order": (cfg.get("withdrawal", {}) or {}).get("funding_order")
                          or LONGEVITY_ORDERS[0],
        "rows": rows,
    }



# ---------------------------------------------------------------------------
# Funding Order — "The Hidden Lever"
# Runs the SAME configured plan (conversions unchanged) under two or more
# withdrawal funding orders and reports the side-by-side estate/heir metrics
# that otherwise require generating separate reports.
# ---------------------------------------------------------------------------
VALID_FUNDING_ORDERS = [
    "Cash → Taxable → IRA → Roth",   # Taxable-first
    "Cash → IRA → Taxable → Roth",   # IRA-first
    "Split IRA & Taxable",           # Split
]


def _fo_death_years(cfg: dict):
    """First/second death calendar years from household DOB + life expectancy.
    Mirrors the frontend deriveDeathYears() fallback to projection.end_year."""
    h = cfg.get("household", {}) or {}
    def _d(dob, le):
        return (dob + le) if (dob and le) else None
    c = _d(h.get("client_dob_year"), h.get("client_life_expectancy"))
    s = _d(h.get("spouse_dob_year"), h.get("spouse_life_expectancy"))
    end = (cfg.get("projection", {}) or {}).get("end_year")
    if c is not None and s is not None:
        return min(c, s), max(c, s)
    only = c if c is not None else (s if s is not None else end)
    return only, only


def _fo_row_at(rows: list, yr):
    if not rows:
        return {}
    if yr is None:
        return rows[-1]
    for r in rows:
        if (r.get("year", 0) or 0) >= yr:
            return r
    return rows[-1]


def _fo_weighted_taxable_return(cfg: dict) -> float:
    accts = [a for a in cfg.get("accounts", []) if a.get("tax_type") == "Taxable"]
    total = sum((a.get("beginning_balance", 0) or 0) for a in accts)
    if total <= 0:
        return 0.06
    wr = sum((a.get("return", 0) or 0) * (a.get("beginning_balance", 0) or 0) for a in accts) / total
    return round(wr, 3) if wr > 0 else 0.06


def _fo_fed_estate_tax_no_trust(cfg: dict, rows: list) -> dict:
    """Federal (+state) estate tax at second death under the no-trust /
    portability-only baseline (Plan 1), computed with the full estate engine
    so it reflects the actual balances left under this funding order."""
    from estate import project_estate  # local import avoids circular import
    first, second = _fo_death_years(cfg)
    y1 = _fo_row_at(rows, first)
    y2 = _fo_row_at(rows, second)
    y1_roth = y1.get("roth", 0) or 0
    y1_taxable = (y1.get("taxable", 0) or 0) + (y1.get("real_estate", 0) or 0) + (y1.get("cash", 0) or 0)
    y1_trad = y1.get("traditional", 0) or 0
    growth = _fo_weighted_taxable_return(cfg)
    lc = cfg.get("legacy", {}) or {}
    heir_rate = (lc.get("heir_federal_rate", 0.32) or 0) + (lc.get("heir_state_rate", 0.04) or 0)
    indexing = (cfg.get("projection", {}) or {}).get("general_inflation", 0.03)
    adj_first, adj_second = _cfg_adjusted_gifts(cfg)
    try:
        res = project_estate(
            first_death_year=first, second_death_year=second,
            deceased_roth_at_y1=y1_roth / 2, deceased_taxable_at_y1=y1_taxable / 2,
            survivor_roth_at_y1=y1_roth / 2, survivor_taxable_at_y1=y1_taxable / 2,
            traditional_at_y1=y1_trad,
            trust_growth_rate=growth, survivor_growth_rate=growth,
            heir_marginal_rate=heir_rate, state_code="",
            use_portability=True, gst_funding_order="roth_first",
            indexing_rate=indexing, horizons_after_second_death=(0,),
            y2_roth=y2.get("roth", 0) or 0,
            y2_taxable=(y2.get("taxable", 0) or 0) + (y2.get("real_estate", 0) or 0) + (y2.get("cash", 0) or 0),
            y2_traditional=y2.get("traditional", 0) or 0,
            adjusted_gifts_first_death=adj_first,
            adjusted_gifts_second_death=adj_second,
        )
        out = (res or {}).get("outcomes", {}).get("portability", {}) or {}
        return {
            "federal_estate_tax": out.get("fed_tax"),
            "state_estate_tax": out.get("state_tax"),
            "estate_at_second_death": out.get("estate_y2"),
        }
    except Exception:
        logging.exception("funding-order FET (no-trust) failed")
        return {"federal_estate_tax": None, "state_estate_tax": None, "estate_at_second_death": None}


def _fo_break_even_rate(cfg: dict):
    """Beneficiary marginal rate at which converting vs. not converting produces
    equal after-tax wealth to heirs. None => no crossover in the tested band."""
    try:
        be = heir_rate_sensitivity(cfg)
    except Exception:
        logging.exception("funding-order break-even failed")
        return None
    rates = be.get("rates", []) or []
    w = {e["rate"]: e["after_tax_estate_to_heirs"] for e in be.get("branches", {}).get("with_conversions", [])}
    n = {e["rate"]: e["after_tax_estate_to_heirs"] for e in be.get("branches", {}).get("no_conversions", [])}
    pts = sorted((r, w[r] - n[r]) for r in rates if r in w and r in n)
    for i in range(1, len(pts)):
        r0, d0 = pts[i - 1]
        r1, d1 = pts[i]
        if (d0 <= 0 <= d1) or (d0 >= 0 >= d1):
            span = d1 - d0
            if abs(span) < 1e-9:
                return round(r0, 4)
            return round(r0 + (r1 - r0) * (-d0 / span), 4)
    return None


def _funding_order_metrics(cfg: dict, order: str) -> dict:
    c = copy.deepcopy(cfg)
    c.setdefault("withdrawal", {})["funding_order"] = order
    res = run_projection(c)
    summ = res.get("summary", {}) or {}
    leg = res.get("legacy", {}) or {}
    rows = res.get("rows", []) or []

    proj = c.get("projection", {}) or {}
    start = plan_start_year(c, rows)
    disc = plan_discount_rate(c)
    npv = lifetime_tax_present_value(rows, start, disc)

    ending_taxable = summ.get("ending_taxable", 0) or 0
    ending_basis = summ.get("ending_taxable_basis", 0) or 0
    embedded_gain = max(0.0, ending_taxable - ending_basis)
    heir_ltcg = leg.get("heir_ltcg_rate", 0.188) or 0.188
    step_up_value = embedded_gain * heir_ltcg

    fet = _fo_fed_estate_tax_no_trust(c, rows)
    break_even = _fo_break_even_rate(c)

    # Delivery years for the today's-dollars twins: estate figures land at the
    # second death; the after-tax inheritance lands at the SECURE-window end.
    _, second = _fo_death_years(c)
    horizon = int((c.get("legacy", {}) or {}).get("post_death_years", 10) or 10)
    deliver_year = (second + horizon) if second else None

    net_worth = leg.get("gross_estate")
    heirs = leg.get("after_tax_estate_to_heirs")

    return {
        "funding_order": order,
        "total_roth_converted": summ.get("total_roth_converted"),
        "ending_roth": summ.get("ending_roth"),
        "ending_taxable": round(ending_taxable, 2),
        "embedded_unrealized_gain": round(embedded_gain, 2),
        "step_up_value": round(step_up_value, 2),
        "heir_ltcg_rate": round(heir_ltcg, 4),
        "net_worth_at_second_death": net_worth,
        "net_worth_at_second_death_today": round(present_value(net_worth, second, start, disc), 2),
        "federal_estate_tax_no_trust": fet["federal_estate_tax"],
        "federal_estate_tax_no_trust_today": round(present_value(fet["federal_estate_tax"], second, start, disc), 2),
        "state_estate_tax_no_trust": fet["state_estate_tax"],
        "after_tax_to_heirs_secure10": heirs,
        "after_tax_to_heirs_secure10_today": round(present_value(heirs, deliver_year, start, disc), 2),
        "lifetime_tax_nominal": summ.get("lifetime_taxes"),
        "lifetime_tax_npv": round(npv, 2),
        "heir_secure10_ira_tax": leg.get("inherited_ira_tax"),
        "beneficiary_break_even_rate": break_even,
        "start_year": start,
        "discount_rate": round(disc, 4),
        "heir_deliver_year": deliver_year,
        "second_death_year": second,
    }


def funding_order_compare(cfg: dict, orders=None) -> dict:
    """Run the configured plan under each requested funding order and return the
    side-by-side comparison metrics. `orders` is 1-3 of VALID_FUNDING_ORDERS."""
    requested = orders or ["Cash → Taxable → IRA → Roth", "Cash → IRA → Taxable → Roth"]
    seen = []
    for o in requested:
        if o in VALID_FUNDING_ORDERS and o not in seen:
            seen.append(o)
    if not seen:
        seen = ["Cash → Taxable → IRA → Roth", "Cash → IRA → Taxable → Roth"]
    seen = seen[:3]
    return {
        "orders": seen,
        "baseline_order": (cfg.get("withdrawal", {}) or {}).get("funding_order"),
        "results": [_funding_order_metrics(cfg, o) for o in seen],
    }


# ---------------------------------------------------------------------------
# Regime deterministic comparison
# Re-runs the FULL deterministic projection under each named market regime's
# return + inflation profile (not a scaling of baseline), for both the
# with-conversions and no-conversions branches. Reuses the paired-branch
# pattern the funding-order comparison uses. Cached per plan-config hash since
# this is 7 regimes x 2 branches = 14 full projections.
# ---------------------------------------------------------------------------
_REGIME_DET_CACHE = {}
_REGIME_DET_CACHE_ORDER = []


def _regime_branch_metrics(cfg: dict) -> dict:
    """Deterministic headline numbers for one regime+branch full projection."""
    res = run_projection(cfg)
    leg = res.get("legacy", {}) or {}
    summ = res.get("summary", {}) or {}
    return {
        "net_worth_at_second_death": leg.get("gross_estate"),
        "after_tax_to_heirs_secure10": leg.get("after_tax_estate_to_heirs"),
        "lifetime_taxes": summ.get("lifetime_taxes"),
        "ending_net_worth": summ.get("ending_net_worth"),
    }


def regime_deterministic_compare(cfg: dict) -> dict:
    """For every named regime, re-run the deterministic projection (with & without
    conversions) under that regime's return/inflation profile and return per-regime
    net worth at second death, after-tax wealth to heirs at the SECURE-window end,
    and the conversion delta in nominal AND today's dollars. Cached per config hash."""
    import hashlib
    import json as _json
    from market_scenarios import PRESETS, DEFAULT_ID

    key = hashlib.sha256(_json.dumps(cfg, sort_keys=True, default=str).encode()).hexdigest()
    if key in _REGIME_DET_CACHE:
        return _REGIME_DET_CACHE[key]

    baseline_id = (cfg.get("market_scenario") or {}).get("id") or DEFAULT_ID
    start = (cfg.get("projection", {}) or {}).get("start_year")
    first, second = _fo_death_years(cfg)
    horizon = int((cfg.get("legacy", {}) or {}).get("post_death_years", 10) or 10)
    deliver_year = (second + horizon) if second else None

    rows = []
    for pid, preset in PRESETS.items():
        if pid == "custom":
            continue  # 'custom' is a no-op passthrough == the baseline; skip (matches the MC regime table)
        regime_cfg = copy.deepcopy(cfg)
        regime_cfg["market_scenario"] = {"id": pid}
        regime_cfg = apply_market_scenario(regime_cfg)  # no-op for 'custom' (uses user inputs)
        disc = (regime_cfg.get("projection", {}) or {}).get("general_inflation", 0.03) or 0.03

        with_cfg = copy.deepcopy(regime_cfg)
        no_cfg = copy.deepcopy(regime_cfg)
        no_cfg["roth"] = {**(no_cfg.get("roth") or {}), "enabled": False}

        m_with = _regime_branch_metrics(with_cfg)
        m_no = _regime_branch_metrics(no_cfg)

        w = m_with.get("after_tax_to_heirs_secure10") or 0.0
        n = m_no.get("after_tax_to_heirs_secure10") or 0.0
        delta_nom = w - n
        delta_today = present_value(delta_nom, deliver_year, start, disc)

        rows.append({
            "preset_id": pid,
            "label": preset["label"],
            "general_inflation": round(disc, 4),
            "with_conversions": m_with,
            "no_conversions": m_no,
            "conversion_delta_to_heirs_nominal": round(delta_nom, 2),
            "conversion_delta_to_heirs_today": round(delta_today, 2),
        })

    out = {
        "baseline_id": baseline_id,
        "start_year": start,
        "first_death_year": first,
        "second_death_year": second,
        "heir_deliver_year": deliver_year,
        "discount_note": "Today's dollars discount each regime's nominal delta by that regime's own assumed CPI (general_inflation) from the SECURE-window delivery year back to the plan start year.",
        "rows": rows,
    }
    _REGIME_DET_CACHE[key] = out
    _REGIME_DET_CACHE_ORDER.append(key)
    if len(_REGIME_DET_CACHE_ORDER) > 32:
        _REGIME_DET_CACHE.pop(_REGIME_DET_CACHE_ORDER.pop(0), None)
    return out


# ---------------------------------------------------------------------------
# Two-way sensitivity: heir marginal rate x market regime
# Reuses heir_rate_sensitivity (which projects each with/no-conversions branch
# ONCE and re-prices the SECURE-10 heir horizon per candidate rate) evaluated
# under every named market regime. Output is a matrix of the conversion delta in
# after-tax wealth to heirs plus a per-regime interpolated break-even rate.
# Cached per plan-config hash: 6 regimes x 2 branches = 12 full projections.
# ---------------------------------------------------------------------------
TWO_WAY_HEIR_RATES = (0.0, 0.10, 0.14, 0.26, 0.36, 0.41)

TWO_WAY_CAPTION = (
    "The case for conversion should be judged across this whole surface, not at a "
    "single assumed cell. The break-even rate is an output of this household's facts "
    "and this model's assumptions — it moves with the dividend yield, the funding "
    "order, and the heirs' realization behavior, and should never be quoted from a "
    "case study."
)

_TWO_WAY_CACHE = {}
_TWO_WAY_CACHE_ORDER = []


def _break_even_from_points(pts):
    """Given sorted [(rate, delta)] points, return (break_even_rate, extrapolated).
    Interpolate the first sign crossover (same approach as _fo_break_even_rate). If
    none inside the band, extrapolate the last segment linearly to delta=0 and flag
    it 'extrapolated'. If conversion changes nothing (the whole column is ~$0) there
    is no meaningful break-even -> (None, False)."""
    if not pts or all(abs(d) < 1.0 for _, d in pts):
        return None, False
    for i in range(1, len(pts)):
        r0, d0 = pts[i - 1]
        r1, d1 = pts[i]
        if (d0 <= 0 <= d1) or (d0 >= 0 >= d1):
            span = d1 - d0
            if abs(span) < 1e-9:
                return round(r0, 4), False
            return round(r0 + (r1 - r0) * (-d0 / span), 4), False
    if len(pts) >= 2:
        r0, d0 = pts[-2]
        r1, d1 = pts[-1]
        span = d1 - d0
        if abs(span) < 1e-9:
            return None, True
        return round(r1 - d1 * (r1 - r0) / span, 4), True
    return None, False


def two_way_sensitivity(cfg: dict) -> dict:
    """Conversion delta (after-tax wealth to heirs, nominal) across the heir marginal
    rate x market regime surface, plus a per-regime break-even rate. Cached per config
    hash. The 0% rate doubles as the charitable-beneficiary (no income tax) case."""
    import hashlib
    import json as _json
    from market_scenarios import PRESETS

    key = hashlib.sha256(_json.dumps(cfg, sort_keys=True, default=str).encode()).hexdigest()
    if key in _TWO_WAY_CACHE:
        return _TWO_WAY_CACHE[key]

    rates = list(TWO_WAY_HEIR_RATES)
    rate_labels = [
        "0% (charity / no income tax)" if abs(r) < 1e-9 else f"{round(r * 100)}%"
        for r in rates
    ]

    regimes = []
    per_regime = {}
    modeled = None
    for pid, preset in PRESETS.items():
        if pid == "custom":  # no-op passthrough == baseline; excluded (matches MC/deterministic tables)
            continue
        rc = copy.deepcopy(cfg)
        rc["market_scenario"] = {"id": pid}
        be = heir_rate_sensitivity(rc, rates=rates)  # applies the regime internally
        modeled = be.get("modeled_rate")
        w = {e["rate"]: e["after_tax_estate_to_heirs"] for e in be["branches"]["with_conversions"]}
        n = {e["rate"]: e["after_tax_estate_to_heirs"] for e in be["branches"]["no_conversions"]}
        deltas = {r: round(w[r] - n[r], 2) for r in be["rates"] if r in w and r in n}
        pts = sorted((r, deltas[r]) for r in deltas if r <= 0.41 + 1e-9)
        be_rate, extrap = _break_even_from_points(pts)
        # Conversion delta at THIS household's modeled heir rate (an exact data point).
        d_at_modeled = None
        if modeled is not None:
            match = next((r for r in deltas if abs(r - modeled) < 1e-9), None)
            if match is not None:
                d_at_modeled = deltas[match]
        infl = (apply_market_scenario(copy.deepcopy(rc)).get("projection", {}) or {}).get("general_inflation", 0.03)
        regimes.append({"preset_id": pid, "label": preset["label"], "general_inflation": round(infl, 4),
                        "delta_at_modeled": d_at_modeled})
        per_regime[pid] = {"deltas": deltas, "break_even": be_rate, "break_even_extrapolated": extrap}

    matrix = [[per_regime[rg["preset_id"]]["deltas"].get(r) for rg in regimes] for r in rates]
    wins_at_modeled = sum(1 for rg in regimes if (rg.get("delta_at_modeled") or 0) > 1.0)

    # Today's-dollars twin of the whole surface: discount each regime's column by
    # that regime's own assumed CPI from the SECURE-window delivery year back to
    # the plan start. Sign never changes, so wins_at_modeled/break-evens are shared.
    start = plan_start_year(cfg)
    _, second = _fo_death_years(cfg)
    horizon = int((cfg.get("legacy", {}) or {}).get("post_death_years", 10) or 10)
    deliver_year = (second + horizon) if second else None
    factors = [discount_factor(deliver_year, start, rg["general_inflation"]) for rg in regimes]
    for ci, rg in enumerate(regimes):
        dm = rg.get("delta_at_modeled")
        rg["delta_at_modeled_today"] = round(dm * factors[ci], 2) if dm is not None else None
    matrix_today = [
        [(round(matrix[ri][ci] * factors[ci], 2) if matrix[ri][ci] is not None else None)
         for ci in range(len(regimes))]
        for ri in range(len(rates))
    ]

    break_even = [
        {"preset_id": rg["preset_id"],
         "rate": per_regime[rg["preset_id"]]["break_even"],
         "extrapolated": per_regime[rg["preset_id"]]["break_even_extrapolated"]}
        for rg in regimes
    ]

    out = {
        "rates": rates,
        "rate_labels": rate_labels,
        "regimes": regimes,
        "matrix": matrix,           # rate-major: matrix[rate_index][regime_index] = nominal conversion delta
        "matrix_today": matrix_today,  # same shape, discounted to plan-start dollars per regime CPI
        "break_even": break_even,   # per regime
        "modeled_rate": modeled,
        "wins_at_modeled": wins_at_modeled,
        "n_regimes": len(regimes),
        "start_year": start,
        "heir_deliver_year": deliver_year,
        "today_note": ("Today's dollars discount each regime's column by that regime's own assumed CPI "
                       "from the SECURE-window delivery year back to the plan start year."),
        "caption": TWO_WAY_CAPTION,
    }
    _TWO_WAY_CACHE[key] = out
    _TWO_WAY_CACHE_ORDER.append(key)
    if len(_TWO_WAY_CACHE_ORDER) > 32:
        _TWO_WAY_CACHE.pop(_TWO_WAY_CACHE_ORDER.pop(0), None)
    return out


# ---------------------------------------------------------------------------
# Audit Mode — compare a third-party planner's config against the review plan.
# ---------------------------------------------------------------------------
_AUDIT_SECTION_MAP = {
    "accounts": "accounts", "income": "income", "expenses": "expenses",
    "tax": "tax settings", "roth": "Roth strategy", "giving": "giving",
    "projection": "projection settings", "legacy": "legacy & heirs",
    "withdrawal": "withdrawal", "household": "household",
    "market_scenario": "market scenario",
}


def _audit_section(top_key: str) -> str:
    return _AUDIT_SECTION_MAP.get(top_key, top_key)


def _audit_leaf_diffs(a, b, tokens, out):
    """Recurse two config sub-trees, appending leaf differences to `out`.
    tokens is the path (list of str keys / int indices) from the config root."""
    if isinstance(a, dict) or isinstance(b, dict):
        a = a if isinstance(a, dict) else {}
        b = b if isinstance(b, dict) else {}
        for k in sorted(set(a.keys()) | set(b.keys())):
            _audit_leaf_diffs(a.get(k), b.get(k), tokens + [k], out)
        return
    if isinstance(a, list) or isinstance(b, list):
        a = a if isinstance(a, list) else []
        b = b if isinstance(b, list) else []
        for i in range(max(len(a), len(b))):
            av = a[i] if i < len(a) else None
            bv = b[i] if i < len(b) else None
            _audit_leaf_diffs(av, bv, tokens + [i], out)
        return
    # Leaf: compare with tolerance for floats.
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if abs(float(a) - float(b)) < 1e-9:
            return
    elif a == b:
        return
    out.append({"tokens": tokens, "review": a, "planner": b})


def _audit_path_str(tokens) -> str:
    s = ""
    for t in tokens:
        s += f"[{t}]" if isinstance(t, int) else (f".{t}" if s else t)
    return s


def _audit_get(cfg, tokens):
    cur = cfg
    for t in tokens:
        cur = cur[t] if (isinstance(t, int) or (isinstance(cur, dict) and t in cur)) else None
        if cur is None:
            return None
    return cur


def _audit_set(cfg, tokens, value):
    cur = cfg
    for t in tokens[:-1]:
        cur = cur[t]
    cur[tokens[-1]] = value


def _audit_outcomes(cfg: dict) -> dict:
    res = run_projection(cfg)
    summ = res.get("summary", {}) or {}
    leg = res.get("legacy", {}) or {}
    rows = res.get("rows", []) or []
    proj = cfg.get("projection", {}) or {}
    start = plan_start_year(cfg, rows)
    disc = plan_discount_rate(cfg)
    npv = lifetime_tax_present_value(rows, start, disc)
    fet = _fo_fed_estate_tax_no_trust(cfg, rows)
    return {
        "net_worth_at_second_death": leg.get("gross_estate") or 0.0,
        "after_tax_to_heirs_secure10": leg.get("after_tax_estate_to_heirs") or 0.0,
        "lifetime_tax_nominal": summ.get("lifetime_taxes") or 0.0,
        "lifetime_tax_npv": round(npv, 2),
        "total_conversions": summ.get("total_roth_converted") or 0.0,
        "federal_estate_tax_no_trust": fet.get("federal_estate_tax") or 0.0,
        "state_estate_tax_no_trust": fet.get("state_estate_tax") or 0.0,
    }


def audit_compare(review_cfg: dict, planner_cfg: dict, max_attribution: int = 12) -> dict:
    """Compare the review plan against a third-party planner's config: assumption
    diff, outcomes + deltas (nominal & today's dollars), and a single-variable
    attribution waterfall (planner -> review) on after-tax wealth to heirs."""
    # ---- (a) assumption diff ----
    raw = []
    _audit_leaf_diffs(review_cfg, planner_cfg, [], raw)
    diffs = []
    grouped = {}
    for d in raw:
        section = _audit_section(d["tokens"][0]) if d["tokens"] else "other"
        entry = {"path": _audit_path_str(d["tokens"]), "section": section,
                 "review": d["review"], "planner": d["planner"]}
        diffs.append({**entry, "tokens": d["tokens"]})
        grouped.setdefault(section, []).append(entry)

    # ---- (b) outcomes + deltas ----
    o_review = _audit_outcomes(review_cfg)
    o_planner = _audit_outcomes(planner_cfg)
    proj = review_cfg.get("projection", {}) or {}
    start = proj.get("start_year", 0)
    disc = proj.get("general_inflation", 0.03) or 0.03
    _, second = _fo_death_years(review_cfg)
    horizon = int((review_cfg.get("legacy", {}) or {}).get("post_death_years", 10) or 10)
    deliver_year = (second + horizon) if second else None
    f_second = discount_factor(second, start, disc)
    f_deliver = discount_factor(deliver_year, start, disc)
    # which discount factor anchors each metric's "today's dollars"
    anchor = {
        "net_worth_at_second_death": f_second,
        "after_tax_to_heirs_secure10": f_deliver,
        "lifetime_tax_nominal": f_second,
        "lifetime_tax_npv": 1.0,   # already a present value
        "total_conversions": f_second,
        "federal_estate_tax_no_trust": f_second,
        "state_estate_tax_no_trust": f_second,
    }
    outcomes = {"review": o_review, "planner": o_planner, "deltas": {}}
    for k in o_review:
        dn = round(o_review[k] - o_planner[k], 2)
        outcomes["deltas"][k] = {
            "review": round(o_review[k], 2),
            "planner": round(o_planner[k], 2),
            "delta_nominal": dn,
            "delta_today": round(dn * anchor.get(k, 1.0), 2),
        }

    # ---- (c) attribution — single-variable trials, waterfall per target metric ----
    # Run each single-variable trial ONCE, capturing the FULL outcome set, then build
    # a waterfall for any target metric from the same runs (no extra projections).
    trials = []
    for d in diffs:
        trial = copy.deepcopy(planner_cfg)
        try:
            _audit_set(trial, d["tokens"], d["review"])
        except (KeyError, IndexError, TypeError):
            continue
        trials.append({"path": d["path"], "section": d["section"],
                       "review": d["review"], "planner": d["planner"],
                       "out": _audit_outcomes(trial)})

    def _build_wf(metric):
        base_m = o_planner[metric]
        target_m = o_review[metric]
        total = round(target_m - base_m, 2)
        contribs = [{"path": t["path"], "section": t["section"], "review": t["review"],
                     "planner": t["planner"], "impact": round(t["out"][metric] - base_m, 2)}
                    for t in trials]
        contribs.sort(key=lambda c: abs(c["impact"]), reverse=True)
        kept = contribs[:max_attribution]
        explained = round(sum(c["impact"] for c in kept), 2)
        residual = round(total - explained, 2)
        wf = [{"label": "Planner outcome", "type": "start",
               "value": round(base_m, 2), "cumulative": round(base_m, 2)}]
        running = base_m
        for c in kept:
            running += c["impact"]
            wf.append({"label": c["path"], "section": c["section"], "type": "step",
                       "review": c["review"], "planner": c["planner"],
                       "value": c["impact"], "cumulative": round(running, 2)})
        wf.append({"label": "Interaction & residual", "type": "residual",
                   "value": residual, "cumulative": round(running + residual, 2)})
        wf.append({"label": "Review outcome", "type": "end",
                   "value": round(target_m, 2), "cumulative": round(target_m, 2)})
        top_driver = kept[0]["path"] if kept else None
        return {
            "metric": metric,
            "planner_outcome": round(base_m, 2),
            "review_outcome": round(target_m, 2),
            "total_gap": total,
            "explained": explained,
            "interaction_residual": residual,
            "n_diffs": len(diffs),
            "n_attributed": len(kept),
            "top_driver": top_driver,
            "waterfall": wf,
        }

    metric_labels = {
        "after_tax_to_heirs_secure10": "After-tax wealth to heirs",
        "lifetime_tax_nominal": "Lifetime income tax",
        "federal_estate_tax_no_trust": "Federal estate tax (no trust)",
    }
    by_metric = {m: _build_wf(m) for m in metric_labels}
    attribution = by_metric["after_tax_to_heirs_secure10"]

    return {
        "assumption_diff": {"count": len(diffs), "grouped": grouped,
                            "list": [{k: v for k, v in d.items() if k != "tokens"} for d in diffs]},
        "outcomes": outcomes,
        "attribution": attribution,
        "attribution_by_metric": by_metric,
        "metric_labels": metric_labels,
        "meta": {"start_year": start, "second_death_year": second,
                 "heir_deliver_year": deliver_year, "discount_rate": round(disc, 4)},
    }


# ---------------------------------------------------------------------------
# Mortality Timing sensitivity — re-run the deterministic projection under five
# death-timing scenarios (base; first death ±5y; second death ±5y).
# ---------------------------------------------------------------------------
def _mortality_shift_cfg(cfg, which, delta):
    """Return a cfg copy with `which` ('first'|'second') decedent's death moved by
    `delta` years, clamped so first<=second and neither death predates the start year."""
    from tax_engine import federal_ordinary_tax  # noqa: F401 (import guard)
    out = copy.deepcopy(cfg)
    h = out.get("household", {}) or {}
    start = (out.get("projection", {}) or {}).get("start_year", 0)
    has_spouse = h.get("spouse_dob_year") is not None
    c_dob = h.get("client_dob_year") or start
    s_dob = h.get("spouse_dob_year") or c_dob
    c_le = h.get("client_life_expectancy") or 0
    s_le = h.get("spouse_life_expectancy") or 0
    c_death, s_death = c_dob + c_le, s_dob + s_le
    if not has_spouse:
        first_owner = "client"
    else:
        first_owner = "client" if c_death <= s_death else "spouse"
    second_owner = "spouse" if first_owner == "client" else "client"
    target = first_owner if which == "first" else second_owner
    if target == "client":
        new_death = max(start, c_death + delta)
        if which == "first" and has_spouse:
            new_death = min(new_death, s_death)          # first cannot pass second
        if which == "second":
            new_death = max(new_death, s_death) if has_spouse else new_death
        out["household"]["client_life_expectancy"] = max(0, new_death - c_dob)
    else:
        new_death = max(start, s_death + delta)
        if which == "first":
            new_death = min(new_death, c_death)
        if which == "second":
            new_death = max(new_death, c_death)
        out["household"]["spouse_life_expectancy"] = max(0, new_death - s_dob)
    return out


def _mortality_metrics(cfg):
    from tax_engine import federal_ordinary_tax
    res = run_projection(cfg)
    rows = res.get("rows", []) or []
    summ = res.get("summary", {}) or {}
    leg = res.get("legacy", {}) or {}
    proj = cfg.get("projection", {}) or {}
    start = proj.get("start_year", rows[0]["year"] if rows else 0)
    infl = proj.get("bracket_indexing") or proj.get("general_inflation", 0.03) or 0.03
    single_years, comp = 0, 0.0
    for row in rows:
        fs = row.get("filing_status")
        if fs and fs != "MFJ":
            single_years += 1
            ordv = row.get("ordinary_taxable_income", 0) or 0
            idx = (1 + infl) ** max(0, (row.get("year", start) - start))
            comp += max(0.0, federal_ordinary_tax(ordv, False, idx) - federal_ordinary_tax(ordv, True, idx))
    fet = _fo_fed_estate_tax_no_trust(cfg, rows)
    _, second = _fo_death_years(cfg)
    horizon = int((cfg.get("legacy", {}) or {}).get("post_death_years", 10) or 10)
    no_cfg = copy.deepcopy(cfg)
    no_cfg["roth"] = {**(cfg.get("roth") or {}), "enabled": False}
    heirs_no = (run_projection(no_cfg).get("legacy", {}) or {}).get("after_tax_estate_to_heirs") or 0.0
    heirs_with = leg.get("after_tax_estate_to_heirs") or 0.0
    return {
        "single_filer_years": single_years,
        "bracket_compression_cost": round(comp, 2),
        "net_worth_at_second_death": leg.get("gross_estate") or 0.0,
        "federal_estate_tax_no_trust": fet.get("federal_estate_tax") or 0.0,
        "after_tax_to_heirs_secure10": heirs_with,
        "conversion_delta": round(heirs_with - heirs_no, 2),
        "second_death_year": second,
        "secure_window_end_year": (second + horizon) if second else None,
        "_start": start, "_infl": infl,
    }


def mortality_timing_compare(cfg: dict) -> dict:
    """Five death-timing scenarios with per-scenario widow-year, estate and heir
    metrics + the conversion delta in nominal and today's dollars."""
    base_m = _mortality_metrics(cfg)
    start = base_m["_start"]
    infl = base_m["_infl"]
    scen_defs = [
        ("base", "Base case", None, 0),
        ("first_earlier", "First death 5 yrs earlier", "first", -5),
        ("first_later", "First death 5 yrs later", "first", 5),
        ("second_earlier", "Second death 5 yrs earlier", "second", -5),
        ("second_later", "Second death 5 yrs later", "second", 5),
    ]
    rows = []
    for sid, label, which, delta in scen_defs:
        m = base_m if which is None else _mortality_metrics(_mortality_shift_cfg(cfg, which, delta))
        end_yr = m.get("secure_window_end_year")
        f_deliver = discount_factor(end_yr, start, infl)
        rows.append({
            "id": sid, "label": label,
            "single_filer_years": m["single_filer_years"],
            "bracket_compression_cost": m["bracket_compression_cost"],
            "net_worth_at_second_death": round(m["net_worth_at_second_death"], 2),
            "federal_estate_tax_no_trust": round(m["federal_estate_tax_no_trust"], 2),
            "after_tax_to_heirs_secure10": round(m["after_tax_to_heirs_secure10"], 2),
            "conversion_delta_nominal": round(m["conversion_delta"], 2),
            "conversion_delta_today": round(m["conversion_delta"] * f_deliver, 2),
            "second_death_year": m["second_death_year"],
            "secure_window_end_year": end_yr,
        })
    return {"start_year": start, "discount_rate": round(infl, 4), "rows": rows}


# ---------------------------------------------------------------------------
# Charitable Beneficiary — death-time IRA-to-charity designation vs conversions.
# Three cases at the user's settings: no charity; IRA fraction to charity WITH
# the current conversion program; IRA fraction to charity with conversions off.
# ---------------------------------------------------------------------------
def charitable_beneficiary_compare(cfg: dict, fraction=None) -> dict:
    """Compare family after-tax, charity receipt, combined total, and total tax
    paid by everyone under three cases, with nominal + today's-dollars deltas."""
    cfg_frac = 0.0
    try:
        cfg_frac = float((cfg.get("beneficiary") or {}).get("ira_to_charity_fraction", 0.0) or 0.0)
    except (TypeError, ValueError):
        cfg_frac = 0.0
    frac = fraction if fraction is not None else (cfg_frac if cfg_frac > 0 else 1.0)
    frac = max(0.0, min(1.0, frac))

    start = plan_start_year(cfg)
    disc = plan_discount_rate(cfg)
    _, second = _fo_death_years(cfg)
    horizon = int((cfg.get("legacy", {}) or {}).get("post_death_years", 10) or 10)
    deliver_year = (second + horizon) if second else None
    FED_RATE = 0.40

    def _branch(charity_frac, roth_on):
        c = copy.deepcopy(cfg)
        c.setdefault("beneficiary", {})["ira_to_charity_fraction"] = charity_frac
        if not roth_on:
            c["roth"] = {**(c.get("roth") or {}), "enabled": False}
        res = run_projection(c)
        leg = res.get("legacy", {}) or {}
        summ = res.get("summary", {}) or {}
        rows = res.get("rows", []) or []
        family = leg.get("after_tax_estate_to_heirs") or 0.0
        charity = leg.get("charitable_ira_amount") or 0.0
        # A charity is tax-exempt: it invests its receipt over the same SECURE-10
        # horizon the family's after-tax figure is measured across, tax-free —
        # exactly parallel to an inherited Roth. Grow it so the combined total is
        # apples-to-apples in time.
        tax_free_r = next((a.get("return", 0.07) for a in (c.get("accounts") or [])
                           if a.get("tax_type") == "Tax-Free"), 0.07) or 0.07
        charity_endowment = charity * ((1.0 + tax_free_r) ** horizon)
        lifetime_tax = summ.get("lifetime_taxes") or 0.0
        heir_ira_tax = leg.get("inherited_ira_tax") or 0.0
        base_est = (_fo_fed_estate_tax_no_trust(c, rows) or {}).get("federal_estate_tax") or 0.0
        # Charitable deduction removes the charity IRA from the taxable estate.
        est_tax = max(0.0, base_est - FED_RATE * charity)
        return {
            "family_after_tax": round(family, 2),
            "charity_receipt": round(charity, 2),
            "charity_endowment_value": round(charity_endowment, 2),
            "combined_family_charity": round(family + charity_endowment, 2),
            "lifetime_tax": round(lifetime_tax, 2),
            "heir_ira_tax": round(heir_ira_tax, 2),
            "federal_estate_tax": round(est_tax, 2),
            "taxable_estate_charitable_deduction": round(charity, 2),
            "total_tax_everyone": round(lifetime_tax + heir_ira_tax + est_tax, 2),
            "total_roth_converted": round(summ.get("total_roth_converted") or 0.0, 2),
        }

    cases = {
        "no_charity": _branch(0.0, True),
        "charity_with_conversions": _branch(frac, True),
        "charity_no_conversions": _branch(frac, False),
    }

    def _delta(a, b):
        nom = round(a - b, 2)
        return {"nominal": nom, "today": round(present_value(nom, deliver_year, start, disc), 2)}

    winner = max(cases.keys(), key=lambda k: cases[k]["combined_family_charity"])
    return {
        "fraction": round(frac, 4),
        "fraction_is_illustrative": cfg_frac <= 0,
        "start_year": start,
        "discount_rate": round(disc, 4),
        "heir_deliver_year": deliver_year,
        "cases": cases,
        "combined_delta_conversions_effect": _delta(
            cases["charity_with_conversions"]["combined_family_charity"],
            cases["charity_no_conversions"]["combined_family_charity"]),
        "winner": winner,
        "note": ("QCDs give from the pre-tax IRA during life; a death-time charitable "
                 "beneficiary designation gives from the same pool at death — the two "
                 "compete for the same dollars."),
    }
