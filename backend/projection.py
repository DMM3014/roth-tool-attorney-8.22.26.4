"""Multi-year retirement projection engine.

Year-by-year simulation built on top of tax_engine.compute_year_tax, mirroring
the spreadsheet's CashFlow/Accounts/RMD/Income/Tax circular relationship
(taxes -> withdrawals -> taxable income -> taxes), resolved by iteration.
"""
from __future__ import annotations
from datetime import date

from tax_engine import compute_year_tax, optimize_conversion, rmd_divisor, bracket_ceiling


def _age(dob_year: int, year: int) -> int:
    return year - dob_year


def _alive(dob_year: int, death_age: int, year: int) -> bool:
    return _age(dob_year, year) <= death_age


def _stream_amount(s: dict, year: int, both_alive: bool, survivor_owner: str | None) -> tuple[float, str]:
    """Annual amount for an income stream in `year`, returns (amount, tax_character)."""
    if not s.get("use", True):
        return 0.0, s.get("tax_character", "Ordinary")
    start = s.get("start_year", 2026)
    stop = s.get("stop_year")
    if year < start:
        return 0.0, s.get("tax_character", "Ordinary")
    if stop and year > stop:
        return 0.0, s.get("tax_character", "Ordinary")

    base = s.get("amount", 0.0)
    freq = 12 if s.get("frequency", "Annual") == "Monthly" else 1
    annual = base * freq
    cola = s.get("cola", 0.0)
    annual *= (1 + cola) ** max(0, year - start)

    # survivor handling: if owner has died, apply survivor %
    if not both_alive and survivor_owner is not None:
        owner = s.get("owner", "Joint")
        if owner != "Joint" and owner != survivor_owner:
            annual *= s.get("survivor_pct", 0.0)
    return annual, s.get("tax_character", "Ordinary")


def _aggregate_income(streams, year, client_alive, spouse_alive, both_alive, has_spouse, survivor_owner):
    """Sum income streams into (ordinary_non_ss, gross_ss, recurring_div) for a year."""
    ordinary_non_ss = 0.0
    gross_ss = 0.0
    recurring_div = 0.0
    for s in streams:
        owner = s.get("owner", "Joint")
        owner_alive = (owner == "Joint" or (owner == "Client" and client_alive)
                       or (owner == "Spouse" and spouse_alive))
        if not owner_alive and s.get("tax_character") != "SS" and owner != "Joint":
            continue
        amt, char = _stream_amount(s, year, both_alive, survivor_owner)
        if char == "SS":
            if not both_alive and has_spouse:
                if (owner == "Client" and client_alive) or (owner == "Spouse" and spouse_alive):
                    gross_ss += amt
            else:
                gross_ss += amt
        elif char == "QDiv/LTCG":
            recurring_div += amt
        elif char == "Annuity":
            ordinary_non_ss += amt * s.get("taxable_pct", 1.0)
        else:
            ordinary_non_ss += amt

    # survivor SS = higher of the two benefits (approximate)
    if not both_alive and has_spouse and gross_ss == 0:
        ss_vals = [_stream_amount(s, year, True, None)[0]
                   for s in streams if s.get("tax_character") == "SS"]
        if ss_vals:
            gross_ss = max(ss_vals)
    return ordinary_non_ss, gross_ss, recurring_div


def _total_rmd(ira_ids, acc_by_id, bal, client_alive, spouse_alive,
               client_dob, spouse_dob, has_spouse, year):
    """Sum Required Minimum Distributions across tax-deferred accounts."""
    rmd_total = 0.0
    for aid in ira_ids:
        owner = acc_by_id[aid].get("owner", "Client")
        owner_alive = (owner == "Client" and client_alive) or (owner == "Spouse" and spouse_alive)
        if not owner_alive:
            continue
        dob = client_dob if owner == "Client" else (spouse_dob if has_spouse else client_dob)
        div = rmd_divisor(_age(dob, year))
        if div > 0 and bal[aid] > 0:
            rmd_total += bal[aid] / div
    return rmd_total


def _total_expenses(expenses, year, client_alive, spouse_alive, both_alive,
                    start_year, survivor_reduction):
    """Sum active, inflated expenses for a year (survivor-adjusted after first death)."""
    total = 0.0
    for e in expenses:
        if not e.get("use", True):
            continue
        owner = e.get("owner", "Joint")
        owner_alive = (owner == "Joint" or (owner == "Client" and client_alive)
                       or (owner == "Spouse" and spouse_alive))
        if not owner_alive:
            continue
        es, ee = e.get("start_year", start_year), e.get("stop_year")
        if year < es or (ee and year > ee):
            continue
        freq = 12 if e.get("frequency", "Annual") == "Monthly" else 1
        total += e.get("amount", 0.0) * freq * (1 + e.get("inflation", 0.03)) ** max(0, year - es)
    if not both_alive:
        total *= (1 - survivor_reduction)
    return total


def _compute_legacy(cfg: dict, final: dict) -> dict:
    """Estate at second death: step-up on taxable/home, heir tax on inherited IRA, tax-free Roth."""
    lc = cfg.get("legacy", {})
    settlement_pct = lc.get("estate_settlement_pct", 0.01)
    heir_ord_rate = lc.get("heir_ordinary_rate", 0.30)
    step_up = lc.get("step_up_at_death", True)
    mortgage = cfg.get("mortgage_balance", 0.0)

    end_nw = final.get("net_worth", 0)
    end_trad = final.get("traditional", 0)
    end_roth = final.get("roth", 0)

    gross_estate = max(0.0, end_nw - mortgage)
    estate_settlement = settlement_pct * gross_estate
    inherited_ira_tax = end_trad * heir_ord_rate  # SECURE 10-yr, PV-at-death approximation
    after_tax_estate = gross_estate - estate_settlement - inherited_ira_tax
    return {
        "gross_estate": round(gross_estate, 2),
        "estate_settlement": round(estate_settlement, 2),
        "inherited_ira_tax": round(inherited_ira_tax, 2),
        "tax_free_roth_to_heirs": round(end_roth, 2),
        "after_tax_estate_to_heirs": round(after_tax_estate, 2),
        "heir_ordinary_rate": heir_ord_rate,
        "step_up_at_death": step_up,
    }


def run_projection(cfg: dict) -> dict:
    h = cfg["household"]
    p = cfg["projection"]
    start_year = p["start_year"]
    end_year = p["end_year"]
    bracket_index_rate = p.get("bracket_indexing", 0.03)
    irmaa_index_rate = p.get("irmaa_indexing", 0.03)

    client_dob = h["client_dob_year"]
    spouse_dob = h.get("spouse_dob_year")
    client_death = h["client_life_expectancy"]
    spouse_death = h.get("spouse_life_expectancy", 200)
    has_spouse = spouse_dob is not None

    state_rate = cfg["tax"]["state_rate"]
    include_irmaa = cfg["tax"].get("include_irmaa", True)
    survivor_status = cfg["tax"].get("survivor_filing_status", "Single")

    roth = cfg["roth"]
    roth_enabled = roth.get("enabled", True)
    conv_start = roth.get("start_year", start_year)
    conv_end = roth.get("end_year", end_year)
    target_rate = roth.get("target_bracket", 0.24)
    max_annual = roth.get("max_annual", 0.0)
    stop_at_rmd = roth.get("stop_at_rmd_age", True)

    streams = cfg["income_streams"]
    expenses = cfg["expenses"]
    accounts = cfg["accounts"]
    div_yield = cfg.get("dividend_yield", 0.02)
    cash_rate = next((a["return"] for a in accounts if a["tax_type"] == "Cash"), 0.03)

    # mutable balances
    bal = {a["id"]: a["beginning_balance"] for a in accounts}
    basis = {a["id"]: a.get("cost_basis", 0.0) for a in accounts}
    acc_by_id = {a["id"]: a for a in accounts}

    cash_ids = [a["id"] for a in accounts if a["tax_type"] == "Cash"]
    taxable_ids = [a["id"] for a in accounts if a["tax_type"] == "Taxable"]
    ira_ids = [a["id"] for a in accounts if a["tax_type"] == "Tax-Deferred"]
    roth_ids = [a["id"] for a in accounts if a["tax_type"] == "Tax-Free"]
    other_ids = [a["id"] for a in accounts if a["tax_type"] in ("Real Estate",)]

    rows = []

    for year in range(start_year, end_year + 1):
        yr_off = year - start_year
        bracket_index = (1 + bracket_index_rate) ** yr_off
        irmaa_index = (1 + irmaa_index_rate) ** yr_off

        client_alive = _alive(client_dob, client_death, year)
        spouse_alive = has_spouse and _alive(spouse_dob, spouse_death, year)
        both_alive = client_alive and spouse_alive
        anyone_alive = client_alive or spouse_alive
        if not anyone_alive:
            break

        if both_alive:
            filing = "MFJ"
        else:
            filing = survivor_status
        survivor_owner = None
        if not both_alive and has_spouse:
            survivor_owner = "Client" if client_alive else "Spouse"

        # 65+ and medicare counts
        num65 = 0
        med_count = 0
        for alive, dob in ((client_alive, client_dob), (spouse_alive, spouse_dob if has_spouse else None)):
            if alive and dob is not None:
                if _age(dob, year) >= 65:
                    num65 += 1
                    med_count += 1

        # --- income streams ---
        ordinary_non_ss, gross_ss, recurring_div = _aggregate_income(
            streams, year, client_alive, spouse_alive, both_alive, has_spouse, survivor_owner)

        # --- RMDs ---
        rmd_total = _total_rmd(ira_ids, acc_by_id, bal, client_alive, spouse_alive,
                               client_dob, spouse_dob, has_spouse, year)

        cash_boy = sum(bal[i] for i in cash_ids)
        cash_interest = cash_boy * cash_rate

        # --- Roth conversion (fill the bracket) ---
        ira_balance = sum(bal[i] for i in ira_ids)
        conversion = 0.0
        in_window = roth_enabled and conv_start <= year <= conv_end and ira_balance > 0
        client_rmd_age = _age(client_dob, year) >= 73
        if stop_at_rmd and client_rmd_age:
            in_window = False
        if in_window:
            base_inp = {
                "filing_status": filing, "year": year,
                "bracket_index": bracket_index, "irmaa_index": irmaa_index,
                "num_65plus": num65, "medicare_count": med_count,
                "ordinary_non_ss": ordinary_non_ss,
                "ira_distributions": rmd_total,
                "cash_interest": cash_interest, "gross_ss": gross_ss,
                "recurring_div_ltcg": recurring_div, "realized_ltcg": 0.0,
                "state_rate": state_rate, "include_irmaa": include_irmaa,
            }
            opt = optimize_conversion(base_inp, target_rate, max_annual)
            conversion = min(opt["recommended_conversion"], ira_balance)

        # --- expenses ---
        total_expense = _total_expenses(
            expenses, year, client_alive, spouse_alive, both_alive, start_year,
            cfg["tax"].get("survivor_spending_reduction", 0.2))

        # --- circular: taxes <-> taxable withdrawals ---
        realized_ltcg = 0.0
        ira_withdraw = 0.0
        roth_withdraw = 0.0
        total_tax = 0.0
        tax_res = {}
        for _ in range(4):
            ira_dist = rmd_total + conversion + ira_withdraw
            tax_inp = {
                "filing_status": filing, "year": year,
                "bracket_index": bracket_index, "irmaa_index": irmaa_index,
                "num_65plus": num65, "medicare_count": med_count,
                "ordinary_non_ss": ordinary_non_ss,
                "ira_distributions": ira_dist,
                "cash_interest": cash_interest, "gross_ss": gross_ss,
                "recurring_div_ltcg": recurring_div, "realized_ltcg": realized_ltcg,
                "state_rate": state_rate, "include_irmaa": include_irmaa,
            }
            tax_res = compute_year_tax(tax_inp)
            total_tax = tax_res["total_burden"]

            # cash available pre-withdrawal: income streams + RMD + interest - conversion tax-if-from-cash
            non_portfolio_income = ordinary_non_ss + gross_ss + recurring_div + rmd_total + cash_interest
            need = total_expense + total_tax
            shortfall = need - non_portfolio_income - cash_boy
            # reset incremental withdrawals
            ira_withdraw = 0.0
            roth_withdraw = 0.0
            realized_ltcg = 0.0
            if shortfall > 0:
                remaining = shortfall
                # funding order: Taxable then IRA (cash already counted, Roth last)
                for tid in taxable_ids:
                    if remaining <= 0:
                        break
                    take = min(remaining, bal[tid])
                    gain_pct = max(0.0, 1 - basis[tid] / bal[tid]) if bal[tid] > 0 else 0.0
                    realized_ltcg += take * gain_pct
                    remaining -= take
                for iid in ira_ids:
                    if remaining <= 0:
                        break
                    avail = max(0.0, bal[iid] - (rmd_total if iid == ira_ids[0] else 0))
                    take = min(remaining, avail)
                    ira_withdraw += take
                    remaining -= take
                for rid in roth_ids:
                    if remaining <= 0:
                        break
                    take = min(remaining, bal[rid])
                    roth_withdraw += take
                    remaining -= take

        # --- apply flows to balances ---
        # deplete cash to need first
        spend_from_cash = min(cash_boy, total_expense + total_tax)
        for i in cash_ids:
            bal[i] = max(0.0, bal[i] - (spend_from_cash * (bal[i] / cash_boy if cash_boy else 0)))
        # IRA: minus RMD, minus conversion, minus extra withdrawal
        ira_out = rmd_total + conversion + ira_withdraw
        rem = ira_out
        for iid in ira_ids:
            t = min(rem, bal[iid])
            bal[iid] -= t
            rem -= t
        # taxable withdrawals: same shortfall the loop taxed as realized LTCG above
        shortfall_tx = (total_expense + total_tax) - (
            ordinary_non_ss + gross_ss + recurring_div + rmd_total + cash_interest) - cash_boy
        if shortfall_tx > 0:
            remaining = shortfall_tx
            for tid in taxable_ids:
                if remaining <= 0:
                    break
                take = min(remaining, bal[tid])
                bal[tid] -= take
                remaining -= take
        # roth withdrawals
        rem = roth_withdraw
        for rid in roth_ids:
            t = min(rem, bal[rid])
            bal[rid] -= t
            rem -= t
        # conversion lands in roth
        if conversion > 0 and roth_ids:
            bal[roth_ids[0]] += conversion

        # sweep surplus income into cash
        surplus = (ordinary_non_ss + gross_ss + recurring_div + rmd_total + cash_interest) - (total_expense + total_tax)
        if surplus > 0 and cash_ids:
            bal[cash_ids[0]] += surplus

        # --- grow balances (end of year) ---
        for a in accounts:
            aid = a["id"]
            r = a["return"]
            if a["tax_type"] == "Taxable":
                bal[aid] *= (1 + (r - div_yield))
            elif a["tax_type"] in ("Tax-Deferred", "Tax-Free", "Cash", "Real Estate"):
                bal[aid] *= (1 + r)

        liquid = sum(bal[i] for i in cash_ids + taxable_ids + ira_ids + roth_ids)
        net_worth = liquid + sum(bal[i] for i in other_ids)

        rows.append({
            "year": year,
            "filing_status": filing,
            "client_age": _age(client_dob, year) if client_alive else None,
            "spouse_age": _age(spouse_dob, year) if (has_spouse and spouse_alive) else None,
            "ordinary_income": round(ordinary_non_ss + rmd_total + cash_interest, 2),
            "rmd": round(rmd_total, 2),
            "roth_conversion": round(conversion, 2),
            "preferential_income": round(recurring_div + realized_ltcg, 2),
            "gross_ss": round(gross_ss, 2),
            "taxable_income": tax_res["taxable_income"],
            "total_tax": round(total_tax, 2),
            "effective_rate": tax_res["effective_rate"],
            "marginal_rate": tax_res["marginal_ordinary_rate"],
            "cash": round(sum(bal[i] for i in cash_ids), 2),
            "taxable": round(sum(bal[i] for i in taxable_ids), 2),
            "traditional": round(sum(bal[i] for i in ira_ids), 2),
            "roth": round(sum(bal[i] for i in roth_ids), 2),
            "real_estate": round(sum(bal[i] for i in other_ids), 2),
            "net_worth": round(net_worth, 2),
        })

    total_conv = sum(r["roth_conversion"] for r in rows)
    total_tax_paid = sum(r["total_tax"] for r in rows)
    final = rows[-1] if rows else {}

    return {
        "rows": rows,
        "summary": {
            "years": len(rows),
            "total_roth_converted": round(total_conv, 2),
            "lifetime_taxes": round(total_tax_paid, 2),
            "ending_net_worth": final.get("net_worth", 0),
            "ending_roth": final.get("roth", 0),
            "ending_traditional": final.get("traditional", 0),
            "ending_taxable": final.get("taxable", 0),
            "ending_real_estate": final.get("real_estate", 0),
        },
        "legacy": _compute_legacy(cfg, final),
    }


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

