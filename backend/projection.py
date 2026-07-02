"""Multi-year retirement projection engine.

Year-by-year simulation built on top of tax_engine.compute_year_tax, mirroring
the spreadsheet's CashFlow/Accounts/RMD/Income/Tax circular relationship
(taxes -> withdrawals -> taxable income -> taxes), resolved by iteration.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from tax_engine import (compute_year_tax, optimize_conversion, rmd_divisor,
                        rmd_start_age, bracket_ceiling, irmaa_threshold_cap,
                        bracket_fill, irmaa_thresholds)

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
    """Classify one income stream into (ordinary_non_ss, gross_ss, recurring_div) for a year."""
    owner = s.get("owner", "Joint")
    owner_alive = (owner == "Joint" or (owner == "Client" and client_alive)
                   or (owner == "Spouse" and spouse_alive))
    if not owner_alive and s.get("tax_character") != "SS" and owner != "Joint":
        return 0.0, 0.0, 0.0
    amt, char = _stream_amount(s, year, both_alive, survivor_owner)
    if char == "SS":
        # after first death, only the surviving owner's own SS benefit continues
        if not both_alive and has_spouse and not (
                (owner == "Client" and client_alive) or (owner == "Spouse" and spouse_alive)):
            return 0.0, 0.0, 0.0
        return 0.0, amt, 0.0
    if char == "QDiv/LTCG":
        return 0.0, 0.0, amt
    if char == "Annuity":
        return amt * s.get("taxable_pct", 1.0), 0.0, 0.0
    return amt, 0.0, 0.0


def _aggregate_income(streams, year, client_alive, spouse_alive, both_alive, has_spouse, survivor_owner):
    """Sum income streams into (ordinary_non_ss, gross_ss, recurring_div) for a year."""
    ordinary_non_ss = gross_ss = recurring_div = 0.0
    for s in streams:
        o, ss, d = _income_from_stream(s, year, client_alive, spouse_alive,
                                       both_alive, has_spouse, survivor_owner)
        ordinary_non_ss += o
        gross_ss += ss
        recurring_div += d

    # survivor SS = higher of the two benefits (approximate)
    if not both_alive and has_spouse and gross_ss == 0:
        ss_vals = [_stream_amount(s, year, True, None)[0]
                   for s in streams if s.get("tax_character") == "SS"]
        if ss_vals:
            gross_ss = max(ss_vals)
    return ordinary_non_ss, gross_ss, recurring_div


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
        # heirs owe LTCG on post-death appreciation of the taxable/reinvest/home sleeves
        accrued_ltcg = self.heir_ltcg_rate * (max(0.0, self.taxable - self.taxable0)
                                              + max(0.0, self.reinvest - self.reinvest_basis)
                                              + max(0.0, self.re - self.home0))
        return {
            "year_after_death": y,
            "inherited_roth": round(self.roth, 2),
            "inherited_traditional": round(self.trad, 2),
            "ira_tax_paid": round(tax, 2),
            "taxable_and_reinvested": round(self.taxable + self.reinvest, 2),
            "cash": round(self.cash, 2),
            "real_estate": round(self.re, 2),
            "total_to_heirs": round(self.roth + self.trad + self.taxable + self.reinvest
                                    + self.cash + self.re - accrued_ltcg, 2),
        }


def _init_heir_sleeves(final, accounts, heir_rate, settlement_pct, heir_return, heir_ltcg_rate, div_yield):
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
        tax_r=tax_r, cash_r=ret("Cash", 0.03), re_r=ret("Real Estate", 0.035),
        heir_rate=heir_rate, heir_ltcg_rate=heir_ltcg_rate)


def _post_death_horizon(final, accounts, heir_rate, settlement_pct, years=10,
                        heir_return=None, heir_ltcg_rate=0.2345, div_yield=0.02):
    """SECURE Act post-death inherited-account horizon after the 2nd death (matches V9).

    - Inherited Roth keeps compounding TAX-FREE (settlement haircut applied at death).
    - Inherited Traditional IRA is depleted over the horizon at the heirs' ordinary rate;
      after-tax proceeds reinvested in a taxable sleeve (no settlement haircut on the IRA).
    - Taxable & real estate received a basis step-up at death, then compound NET of the
      annual qualified-dividend tax drag; heirs owe LTCG on POST-death appreciation.
    `heir_return`, if provided, overrides the Roth/Traditional/taxable/reinvest growth rate.
    """
    sleeves = _init_heir_sleeves(final, accounts, heir_rate, settlement_pct,
                                 heir_return, heir_ltcg_rate, div_yield)
    rows = [sleeves.step(y, years) for y in range(1, years + 1)]
    total = rows[-1]["total_to_heirs"] if rows else 0.0
    return rows, round(total, 2), round(sleeves.cum_ira_tax, 2)


def _compute_legacy(cfg: dict, final: dict) -> dict:
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
    div_yield = cfg.get("dividend_yield", 0.02)
    mortgage = cfg.get("mortgage_balance", 0.0)
    accounts = cfg["accounts"]

    end_nw = final.get("net_worth", 0)
    end_trad = final.get("traditional", 0)
    end_roth = final.get("roth", 0)

    gross_estate = max(0.0, end_nw - mortgage)
    estate_settlement = settlement_pct * gross_estate

    # immediate (at-death) after-tax value — PV-at-death approximation
    inherited_ira_tax_at_death = end_trad * heir_ord_rate
    after_tax_at_death = gross_estate - estate_settlement - inherited_ira_tax_at_death

    # post-death forward value (mirrors the spreadsheet longevity view)
    post_rows, total_10yr, cum_ira_tax = _post_death_horizon(
        final, accounts, heir_ord_rate, settlement_pct, horizon, heir_return,
        heir_ltcg_rate, div_yield)

    return {
        "gross_estate": round(gross_estate, 2),
        "estate_settlement": round(estate_settlement, 2),
        "inherited_ira_tax": round(cum_ira_tax, 2),
        "tax_free_roth_to_heirs": post_rows[-1]["inherited_roth"] if post_rows else round(end_roth, 2),
        "after_tax_estate_to_heirs": total_10yr,
        "after_tax_estate_at_death": round(after_tax_at_death, 2),
        "heir_ordinary_rate": round(heir_ord_rate, 4),
        "heir_federal_rate": lc.get("heir_federal_rate"),
        "heir_state_rate": lc.get("heir_state_rate"),
        "heir_reinvest_return": heir_return,
        "heir_ltcg_rate": round(heir_ltcg_rate, 4),
        "step_up_at_death": step_up,
        "horizon_years": horizon,
        "post_death_rows": post_rows,
    }


def _withdraw(plan, shortfall, bal, basis, rmd_total):
    """Withdraw `shortfall` (after cash) honoring plan.funding_order.

    Cash is always spent before this; Roth is always last. The middle tier
    (Taxable vs Traditional IRA) order/split is governed by plan.funding_order.
    Returns (withdrawals {id: amount}, realized_ltcg, ira_withdraw, roth_withdraw).
    """
    wd = {}
    realized_ltcg = ira_withdraw = roth_withdraw = 0.0
    if shortfall <= 0:
        return wd, realized_ltcg, ira_withdraw, roth_withdraw

    def cap(aid, is_ira):
        taken = wd.get(aid, 0.0)
        reserve = rmd_total if (is_ira and aid == plan.rmd_reserve_id) else 0.0
        return max(0.0, bal[aid] - taken - reserve)

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
    return wd, realized_ltcg, ira_withdraw, roth_withdraw


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


def _apply_year_flows(plan, bal, basis, flows):
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
    # conversion + discretionary IRA withdrawal drawn in account order (client IRA first)
    rem = flows.ira_draw
    for iid in acct["ira"]:
        t = min(rem, bal[iid])
        bal[iid] -= t
        rem -= t
    # taxable discretionary withdrawals per converged waterfall
    for aid, amt in flows.wd.items():
        if aid in acct["taxable_set"]:
            bal[aid] = max(0.0, bal[aid] - amt)
    # roth withdrawals, then conversion lands in roth
    rem = flows.roth_withdraw
    for rid in acct["roth"]:
        t = min(rem, bal[rid])
        bal[rid] -= t
        rem -= t
    if flows.conversion > 0 and acct["roth"]:
        bal[acct["roth"][0]] += flows.conversion
    # reinvest surplus (after-tax) — default to taxable brokerage (gross return), add basis
    if flows.surplus > 0:
        if plan.surplus_sweep_to == "Taxable" and acct["taxable"]:
            bal[acct["taxable"][0]] += flows.surplus
            basis[acct["taxable"][0]] += flows.surplus
        elif acct["cash"]:
            bal[acct["cash"][0]] += flows.surplus


def _grow_balances(bal, accounts, div_yield):
    """End-of-year growth: taxable appreciates net of dividend yield; others at full return."""
    for a in accounts:
        aid, r = a["id"], a["return"]
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
    cash_boy: float
    total_expense: float
    ira_balance: float
    plan: "Plan"


def _solve_year_conversion(ctx: _SolveCtx, bal: dict, basis: dict):
    """Resolve the circular conversion <-> discretionary-IRA-withdrawal <-> tax relationship
    for one year. The conversion fills the target bracket on TOP of RMDs and any discretionary
    IRA withdrawal used to fund spending (IRA-first funding consumes bracket room, leaving less
    for conversion — mirrors the spreadsheet's iterative solver). Cash interest is taxed but
    retained in cash, so it is NOT counted as fundable income.

    Returns (conversion, tax_res, wd, realized_ltcg, ira_withdraw, roth_withdraw).
    """
    realized_ltcg = ira_withdraw = roth_withdraw = conversion = 0.0
    wd, tax_res = {}, {}
    prev_conv = prev_wd = -1.0
    for _ in range(40):
        conversion = 0.0
        if ctx.in_window:
            base_inp = {**ctx.tax_base, "ira_distributions": ctx.rmd_total + ira_withdraw,
                        "realized_ltcg": realized_ltcg}
            opt = optimize_conversion(base_inp, ctx.target_rate, ctx.max_annual)
            conversion = min(opt["recommended_conversion"], max(0.0, ctx.ira_balance - ira_withdraw))
            if ctx.irmaa_cap is not None:
                magi_ceiling = irmaa_threshold_cap(int(ctx.irmaa_cap), ctx.mfj, ctx.irmaa_index_yplus2)
                conversion = min(conversion, max(0.0, magi_ceiling - opt["before"]["magi"]))

        tax_inp = {**ctx.tax_base,
                   "ira_distributions": ctx.rmd_total + conversion + ira_withdraw,
                   "realized_ltcg": realized_ltcg, "irmaa_magi": ctx.irmaa_magi}
        tax_res = compute_year_tax(tax_inp)
        total_tax = tax_res["total_burden"]

        funding_income = (ctx.tax_base["ordinary_non_ss"] + ctx.tax_base["gross_ss"]
                          + ctx.tax_base["recurring_div_ltcg"] + ctx.rmd_total)
        shortfall = (ctx.total_expense + total_tax) - funding_income - ctx.cash_boy
        wd, realized_ltcg, ira_withdraw, roth_withdraw = _withdraw(
            ctx.plan, shortfall, bal, basis, ctx.rmd_total + conversion)

        if abs(conversion - prev_conv) < 1.0 and abs(ira_withdraw - prev_wd) < 1.0:
            break
        prev_conv, prev_wd = conversion, ira_withdraw
    return conversion, tax_res, wd, realized_ltcg, ira_withdraw, roth_withdraw


def _aggregate_results(cfg: dict, rows: list) -> dict:
    """Roll year rows up into summary totals + the legacy block."""
    final = rows[-1] if rows else {}
    return {
        "rows": rows,
        "summary": {
            "years": len(rows),
            "total_roth_converted": round(sum(r["roth_conversion"] for r in rows), 2),
            "lifetime_taxes": round(sum(r["total_tax"] for r in rows), 2),
            "ending_net_worth": final.get("net_worth", 0),
            "ending_roth": final.get("roth", 0),
            "ending_traditional": final.get("traditional", 0),
            "ending_taxable": final.get("taxable", 0),
            "ending_real_estate": final.get("real_estate", 0),
        },
        "legacy": _compute_legacy(cfg, final),
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


def _parse_plan(cfg: dict) -> Plan:
    """Pull every scalar/list the projection loop needs out of the raw config once."""
    h = cfg["household"]
    p = cfg["projection"]
    roth = cfg["roth"]
    irmaa_cap = roth.get("irmaa_tier_cap")  # None = no cap; int tier (0=base/no surcharge)
    if irmaa_cap in ("", "None", "none"):
        irmaa_cap = None
    accounts = cfg["accounts"]
    cash_ids = [a["id"] for a in accounts if a["tax_type"] == "Cash"]
    taxable_ids = [a["id"] for a in accounts if a["tax_type"] == "Taxable"]
    ira_ids = [a["id"] for a in accounts if a["tax_type"] == "Tax-Deferred"]
    roth_ids = [a["id"] for a in accounts if a["tax_type"] == "Tax-Free"]
    other_ids = [a["id"] for a in accounts if a["tax_type"] in ("Real Estate",)]
    taxable_set = set(taxable_ids)
    wd_cfg = cfg.get("withdrawal", {})
    return Plan(
        cfg=cfg,
        start_year=p["start_year"], end_year=p["end_year"],
        bracket_index_rate=p.get("bracket_indexing", 0.03),
        irmaa_index_rate=p.get("irmaa_indexing", 0.03),
        client_dob=h["client_dob_year"], spouse_dob=h.get("spouse_dob_year"),
        client_death=h["client_life_expectancy"],
        spouse_death=h.get("spouse_life_expectancy", 200),
        has_spouse=h.get("spouse_dob_year") is not None,
        state_rate=cfg["tax"]["state_rate"],
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
        streams=cfg["income_streams"], expenses=cfg["expenses"], accounts=accounts,
        div_yield=cfg.get("dividend_yield", 0.02),
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


def _build_year_row(plan: Plan, status: YearStatus, year: int, bal: dict, calc: YearCalc) -> dict:
    """Serialize one year's end-of-year state into the projection row dict."""
    tax_res = calc.tax_res
    cash_ids, taxable_ids = plan.cash_ids, plan.taxable_ids
    ira_ids, roth_ids, other_ids = plan.ira_ids, plan.roth_ids, plan.other_ids
    liquid = sum(bal[i] for i in cash_ids + taxable_ids + ira_ids + roth_ids)
    net_worth = liquid + sum(bal[i] for i in other_ids)
    return {
        "year": year,
        "filing_status": status.filing,
        "client_age": _age(plan.client_dob, year) if status.client_alive else None,
        "spouse_age": _age(plan.spouse_dob, year) if (plan.has_spouse and status.spouse_alive) else None,
        "ordinary_income": round(calc.ordinary_non_ss + calc.rmd_total + calc.cash_interest, 2),
        "rmd": round(calc.rmd_total, 2),
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
        "tax_breakdown": {
            "ordinary": tax_res["federal_ordinary_tax"],
            "preferential": tax_res["federal_ltcg_tax"],
            "niit": tax_res["niit"],
            "state": tax_res["state_tax"],
            "medicare": tax_res["medicare_premiums"],
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
    }


def run_projection(cfg: dict) -> dict:
    plan = _parse_plan(cfg)

    # mutable balances
    bal = {a["id"]: a["beginning_balance"] for a in plan.accounts}
    basis = {a["id"]: a.get("cost_basis", 0.0) for a in plan.accounts}
    owner_map = {a["id"]: a.get("owner", "Client") for a in plan.accounts}  # reassigned at first death

    magi_history = {}  # year -> MAGI, for the IRMAA 2-year lookback
    client_alive_prev, spouse_alive_prev = True, plan.has_spouse
    rows = []

    for year in range(plan.start_year, plan.end_year + 1):
        yr_off = year - plan.start_year
        bracket_index = (1 + plan.bracket_index_rate) ** yr_off
        irmaa_index = (1 + plan.irmaa_index_rate) ** yr_off

        status = _year_demographics(plan, owner_map, basis, bal, year, client_alive_prev, spouse_alive_prev)
        if not status.anyone_alive:
            break

        # --- income streams ---
        ordinary_non_ss, gross_ss, recurring_div = _aggregate_income(
            plan.streams, year, status.client_alive, status.spouse_alive,
            status.both_alive, plan.has_spouse, status.survivor_owner)

        # --- RMDs ---
        rmd_total, rmd_by = _total_rmd(plan, status, owner_map, bal, year)

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
        irmaa_index_yplus2 = (1 + plan.irmaa_index_rate) ** (yr_off + IRMAA_LOOKBACK_YEARS)

        # --- expenses ---
        total_expense = _total_expenses(
            plan.expenses, year, status.client_alive, status.spouse_alive,
            status.both_alive, plan.start_year, plan.survivor_spending_reduction)

        # --- circular solve: conversion <-> discretionary IRA withdrawal <-> taxes ---
        tax_base = {
            "filing_status": status.filing, "year": year,
            "bracket_index": bracket_index, "irmaa_index": irmaa_index,
            "num_65plus": status.num65, "medicare_count": status.med_count,
            "ordinary_non_ss": ordinary_non_ss, "cash_interest": cash_interest,
            "gross_ss": gross_ss, "recurring_div_ltcg": recurring_div,
            "state_rate": plan.state_rate, "include_irmaa": plan.include_irmaa,
        }
        ctx = _SolveCtx(
            tax_base=tax_base, in_window=in_window, target_rate=plan.target_rate,
            max_annual=plan.max_annual, irmaa_cap=plan.irmaa_cap, mfj=status.mfj,
            irmaa_index_yplus2=irmaa_index_yplus2,
            irmaa_magi=magi_history.get(year - IRMAA_LOOKBACK_YEARS),  # 2-yr lookback
            rmd_total=rmd_total, cash_boy=cash_boy, total_expense=total_expense,
            ira_balance=ira_balance, plan=plan)
        conversion, tax_res, wd, realized_ltcg, ira_withdraw, roth_withdraw = \
            _solve_year_conversion(ctx, bal, basis)
        total_tax = tax_res["total_burden"]

        magi_history[year] = tax_res["magi"]  # record for future-year IRMAA lookback

        spend_need = total_expense + total_tax
        funding_income = ordinary_non_ss + gross_ss + recurring_div + rmd_total
        cash_need = spend_need - funding_income           # income covers spending first
        cash_drawn = min(cash_boy, max(0.0, cash_need))
        surplus = funding_income - spend_need
        # grow BOY balances first, then apply year-end flows (matches the sheet's
        # EOY = BOY×(1+r) ± flows convention; current-year flows do not compound)
        _grow_balances(bal, plan.accounts, plan.div_yield)
        flows = YearFlows(cash_need=cash_need, rmd_by=rmd_by, ira_draw=conversion + ira_withdraw,
                          wd=wd, roth_withdraw=roth_withdraw, conversion=conversion, surplus=surplus)
        _apply_year_flows(plan, bal, basis, flows)

        calc = YearCalc(
            tax_res=tax_res, bracket_index=bracket_index, irmaa_index=irmaa_index,
            ordinary_non_ss=ordinary_non_ss, gross_ss=gross_ss, recurring_div=recurring_div,
            realized_ltcg=realized_ltcg, cash_interest=cash_interest, rmd_total=rmd_total,
            conversion=conversion, total_tax=total_tax, total_expense=total_expense,
            cash_drawn=cash_drawn, ira_withdraw=ira_withdraw, roth_withdraw=roth_withdraw,
            surplus=surplus, wd=wd)
        rows.append(_build_year_row(plan, status, year, bal, calc))

        client_alive_prev, spouse_alive_prev = status.client_alive, status.spouse_alive

    return _aggregate_results(cfg, rows)


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

