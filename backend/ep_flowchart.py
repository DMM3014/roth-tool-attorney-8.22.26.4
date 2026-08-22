"""EP Projection flowchart engine — web replica of the workbook's "EP Projection" tab.

Five estate-funding plans evaluated against the SAME household balances at the
first death (Y1), carried to the second death (Y2). When per-class second-death
balances from the retirement projection are provided (y2_*), each asset class is
scaled to the full cash-flow/tax model's actual Y2 balance so this page
reconciles to the retirement projection; otherwise a uniform growth rate is
applied (legacy behavior):

  Plan 1  no_trust           — everything outright to the survivor; DSUE only.
  Plan 2  disclaimer_roth    — Client's assets pass to the surviving Spouse
                               outright by default; within 9 months the Spouse
                               may DISCLAIM the Client's Roth IRA into a
                               Disclaimer GST Trust. Presented first among the
                               trust-funded structures because it preserves
                               maximum post-mortem OPTIONALITY (Spouse decides
                               whether the estate warrants dynasty planning
                               AFTER observing the actual estate at Client's
                               death). Numerically identical to Plan 4 when
                               the Spouse elects to disclaim (Roth-only Y1
                               funding).
  Plan 3  roth_and_taxable   — client GST trust at Y1, Roth FIRST then Taxable.
  Plan 4  roth_only          — client GST trust at Y1 funded ONLY with Roth so
                               Taxable stays with the survivor for a 2nd step-up.
  Plan 5  second_death_only  — no Y1 trust; survivor funds a GST trust at Y2.

Federal-only (matches the workbook page). Exclusions index at the model's
assumed CPI via estate.fed_exclusion. Trusts are funded only from Roth +
Taxable (never Traditional; cash/house only in Plan 5's everything-at-Y2 fund).

NOTE on the Y2 trust cap: the workbook caps second-death trust funding at
(fed exclusion at Y2 + DSUE). That is the ESTATE-tax shelter. The GST exemption
itself is NOT portable — only min(funded, fed_excl_y2) of the Y2 trust is
GST-exempt. Both figures are reported (`maximum_to_trust` vs `gst_exempt_portion`).
"""
from __future__ import annotations

from estate import fed_exclusion, FED_ESTATE_TAX_RATE


def _fund(roth: float, taxable: float, cap: float, order: str):
    """Route Roth/Taxable into a trust up to `cap` in the given order."""
    if cap <= 0:
        return 0.0, 0.0, roth, taxable
    if order == "taxable_first":
        tax_to = min(taxable, cap)
        roth_to = min(roth, cap - tax_to)
    elif order == "roth_only":
        roth_to = min(roth, cap)
        tax_to = 0.0
    else:  # roth_first
        roth_to = min(roth, cap)
        tax_to = min(taxable, cap - roth_to)
    return roth_to, tax_to, roth - roth_to, taxable - tax_to


PLAN_DEFS = [
    ("no_trust", 1, "No Trust Planning",
     "Everything passes outright to the surviving spouse at first death via the marital "
     "deduction. No GST or Estate Bypass trust is ever funded — the first spouse's GST "
     "exemption is lost (it is not portable) and, for very large estates only, every "
     "dollar over the Surviving Spouse's Estate and GST Exemption (as increased by the "
     "Client's DSUE Amount) is subject to Estate Taxes."),
    ("disclaimer_roth", 2,
     "Direct Client's Assets to Spouse with Disclaimer Trust to Preserve Estate and GST Tax Planning Flexibility",
     "The Client's Will and/or Trust and all Roth IRA and Traditional IRA Beneficiary "
     "Designation Forms name the surviving Spouse as the initial primary beneficiary of "
     "all assets and accounts outright. THE WILL AND ALL IRA BENEFICIARY DESIGNATIONS "
     "MUST ALSO IDENTIFY THE DISCLAIMER TRUST CREATED UNDER THE CLIENT'S WILL AND/OR "
     "TRUST AS THE FIRST CONTINGENT BENEFICIARY OF THE CLIENT'S ASSETS AND ROTH IRA "
     "ACCOUNTS SO THAT THE DISCLAIMER TRUST WILL RECEIVE ALL ASSETS AND ROTH IRA "
     "ACCOUNTS IF THE SURVIVING SPOUSE PREDECEASES THE CLIENT OR DISCLAIMS ALL OR ANY "
     "FRACTION OF THE CLIENT'S ASSETS OR ROTH IRA ACCOUNTS. THE COUPLE'S ESTATE "
     "PLANNING DOCUMENTS MUST BE DRAFTED TO CREATE A DISCLAIMER TRUST. If the Spouse "
     "survives the Client, within nine months of the Client's death (longer if extensions "
     "are filed), the Spouse may DISCLAIM the Client's Roth IRA into a Disclaimer GST "
     "Trust. This plan illustration assumes that only the Client's Roth IRA is disclaimed "
     "and that the Client's taxable brokerage account passes to the Spouse outright and "
     "will receive a SECOND basis step-up at the Spouse's death, and the Client's Cash, "
     "Traditional IRA and House pass outright to the Spouse. Upon the Client's death, "
     "the Disclaimer GST Trust can be funded by a Disclaimer created by the surviving "
     "Spouse up to the Client's Federal Estate Tax exclusion amount, with any excess "
     "reverting to the Spouse and any unused Estate Tax Exemption generating a DSUE "
     "amount portable to the Spouse's estate. The Client's GST Exemption is also "
     "typically allocated to the Disclaimer Trust. Upon Spouse's death, the Spouse's "
     "assets can fund a second GST Trust up to Spouse's exclusion + DSUE with the "
     "balance outright to children. The distinguishing advantage of a disclaimer estate "
     "plan over pre-committed structures is post-mortem OPTIONALITY: the Spouse "
     "observes the actual state of the family's assets, prevailing tax law and personal "
     "circumstances at Client's death — up to nine months (or longer with extensions) — "
     "and elects whether or not to fund the Disclaimer Trust at all. If dynasty and "
     "estate tax planning is not warranted (e.g. Spouse's likely future taxable estate "
     "is below anticipated applicable tax exclusions) the Spouse simply does not "
     "disclaim and every asset stays outright. This will allow the Client's Roth IRA to "
     "be rolled over into the Surviving Spouse's Roth IRA and to continue to compound "
     "tax-free through the Spouse's remaining lifetime and SECURE Act ten-year "
     "withdrawal window, and a second step-up on all of the Client's taxable accounts "
     "(and the home). If estate tax benefits or GST dynasty planning is warranted, the "
     "disclaimer captures the Client's Estate Tax Exemption and non-portable GST "
     "exemption on the Roth (and any other disclaimed assets passing to the Trust), "
     "which may provide benefits because the Client's DSUE amount is frozen at the "
     "Client's death. This Plan does not require Dynasty Trust planning to capture "
     "Estate Tax benefits for the family. Instead of Dynasty Trusts the assets can also "
     "be left outright to children upon the death of the Surviving Spouse. Consult "
     "qualified legal counsel — disclaimers are irrevocable, must satisfy IRC §2518 "
     "form requirements, and the Spouse cannot have accepted any benefit from the "
     "disclaimed asset before the election."),
    ("roth_and_taxable", 3, "Distribute Client's Taxable Assets and Roth IRAs to GST Trust",
     "The Client's GST-exempt trust is funded at first death with the Roth FIRST then "
     "the Client's taxable brokerage account, maximizing use of the GST and Estate Tax "
     "exemptions. Taxable assets transferred to the GST Trust at the Client's death are "
     "locked into their funding-date basis for capital gains tax purposes — it forgoes "
     "the second step-up. However, because the Client's Estate Tax Exemption has been "
     "applied to the Trust, the assets (and all appreciation) are not included in the "
     "Spouse's taxable estate. Upon Spouse's death, Spouse's assets fund a second GST "
     "Trust up to Spouse's GST Exemption Limit with the balance outright to children. "
     "Traditional IRAs (including any Client Traditional IRA rollover) automatically "
     "pass at the Spouse's death outside the trust structure directly to children. This "
     "Plan illustration emphasizes multi-generational estate planning which, due to "
     "increases in relevant exemption amounts, generally impacts the very wealthy and "
     "is often not relevant at typical Client family asset levels, or if this type of "
     "long-term tax planning is not a priority. Trusts also serve many other non-tax "
     "purposes and Clients should consult qualified legal counsel when structuring "
     "their estate plans. This Plan does not require Dynasty Trust planning to capture "
     "Estate Tax benefits for the family. Instead of Dynasty Trusts the assets can also "
     "be left outright to children upon the death of the Surviving Spouse."),
    ("roth_only", 4, "Fund Client's GST Trust with Roth Only",
     "Only Client's Roth IRA funds the client's GST trust at first death. The Client's "
     "taxable brokerage account passes to the Spouse and will receive a SECOND basis "
     "step-up at the Spouse's death, while the Roth compounds estate- and GST-tax free "
     "inside the GST trust. Upon Spouse's death, the Spouse's assets fund a second GST "
     "Trust up to Spouse's GST Exemption Limit with the balance passing outright to "
     "children. Traditional IRAs (including any Client Traditional IRA rollover) "
     "automatically pass at the Spouse's death outside the trust structure directly to "
     "children. This Plan includes multi-generational estate planning which, due to "
     "increases in relevant exemption amounts, generally impacts the very wealthy and "
     "is often not relevant at typical Client family asset levels, or if this type of "
     "long-term tax planning is not a priority. Trusts also serve many other non-tax "
     "purposes and Clients should consult qualified legal counsel when structuring "
     "their estate plans."),
    ("second_death_only", 5, "Fund Only One GST Trust at Spouse's Second Death",
     "No trust at first death — everything to the survivor with full DSUE. The "
     "survivor's estate funds a GST trust at the second death, but the first spouse's "
     "GST exemption (non-portable) is permanently lost. For tax purposes this is "
     "important only if the total family assets passing at the Spouse's Trust exceed "
     "the Spouse's then available GST exemption. This Plan includes multi-generational "
     "estate planning which, due to increases in relevant exemption amounts, generally "
     "impacts the very wealthy and is often not relevant at typical Client family "
     "asset levels, or if this type of long-term tax planning is not a client priority. "
     "Trusts also serve many other non-tax purposes and Clients should consult "
     "qualified legal counsel when structuring their estate plans."),
]


def build_ep_flowchart(*, first_death_year: int, second_death_year: int,
                       client_roth: float = 0.0, client_taxable: float = 0.0,
                       client_cash_house: float = 0.0, client_traditional: float = 0.0,
                       survivor_roth: float = 0.0, survivor_taxable: float = 0.0,
                       survivor_cash_house: float = 0.0, survivor_traditional: float = 0.0,
                       growth_rate: float = 0.06, cap_gains_rate: float = 0.24,
                       heir_income_rate: float = 0.3165,
                       indexing_rate: float | None = None,
                       y2_roth: float | None = None, y2_taxable: float | None = None,
                       y2_cash_house: float | None = None,
                       y2_traditional: float | None = None) -> dict:
    if second_death_year < first_death_year:
        first_death_year, second_death_year = second_death_year, first_death_year
    yrs = second_death_year - first_death_year
    r = max(0.0, growth_rate)
    uniform = (1.0 + r) ** yrs

    trad_total = client_traditional + survivor_traditional
    y1_totals = {
        "roth": client_roth + survivor_roth,
        "taxable": client_taxable + survivor_taxable,
        "cash_house": client_cash_house + survivor_cash_house,
        "traditional": trad_total,
    }
    y2_map = {"roth": y2_roth, "taxable": y2_taxable,
              "cash_house": y2_cash_house, "traditional": y2_traditional}
    use_projection = all(v is not None for v in y2_map.values())
    if use_projection:
        # Per-class scaling factor so each class lands exactly on the retirement
        # model's actual Y2 balance. Classes that are zero at Y1 but nonzero at
        # Y2 get the full Y2 amount credited to the survivor ("orphan" dollars).
        factors = {k: (y2_map[k] / y1_totals[k]) if y1_totals[k] > 0 else uniform
                   for k in y1_totals}
        orphans = {k: (y2_map[k] if y1_totals[k] <= 0 else 0.0) for k in y1_totals}
    else:
        factors = {k: uniform for k in y1_totals}
        orphans = {k: 0.0 for k in y1_totals}

    def g(v: float, cls: str) -> float:
        return v * factors[cls]

    implied_growth = {
        k: (round(factors[k] ** (1.0 / yrs) - 1.0, 4) if yrs > 0 else 0.0)
        for k in factors
    }

    excl_y1 = fed_exclusion(first_death_year, indexing_rate=indexing_rate)
    excl_y2 = fed_exclusion(second_death_year, indexing_rate=indexing_rate)
    total_roth_y2 = g(client_roth + survivor_roth, "roth") + orphans["roth"]

    y1 = {
        "year": first_death_year,
        "client": {"roth": client_roth, "taxable": client_taxable,
                   "cash_house": client_cash_house, "traditional": client_traditional},
        "survivor": {"roth": survivor_roth, "taxable": survivor_taxable,
                     "cash_house": survivor_cash_house, "traditional": survivor_traditional},
    }

    def run_plan(key: str, plan_no: int, title: str, subtitle: str) -> dict:
        # Y1 client-trust funding-order dispatch:
        #   roth_and_taxable → Roth first, then Taxable (both routed up to exclusion)
        #   roth_only        → only Roth (Taxable stays with survivor for 2nd step-up)
        #   disclaimer_roth  → assumes the Spouse disclaims ONLY the Client's Roth
        #                      (Taxable stays with survivor for 2nd step-up) — numerically
        #                      identical to roth_only in the modeled central case; the
        #                      narrative benefit is the post-mortem OPTIONALITY (see the
        #                      plan subtitle).
        y1_order = {"roth_and_taxable": "roth_first",
                    "roth_only": "roth_only",
                    "disclaimer_roth": "roth_only"}.get(key)
        if y1_order:
            roth_to, tax_to, roth_left, tax_left = _fund(client_roth, client_taxable, excl_y1, y1_order)
            funded_y1 = roth_to + tax_to
            dsue = max(0.0, excl_y1 - funded_y1)
            offered_y1 = (client_roth + client_taxable) if y1_order == "roth_first" else client_roth
            funding_y1 = {
                "exclusion_limit": excl_y1,
                "funding_assets": offered_y1,
                "roth_to_trust": roth_to,
                "taxable_to_trust": tax_to,
                "maximum_to_trust": funded_y1,
                "dsue": dsue,
            }
        else:
            roth_to = tax_to = funded_y1 = 0.0
            roth_left, tax_left = client_roth, client_taxable
            dsue = excl_y1
            funding_y1 = None

        ct_roth_y2, ct_tax_y2 = g(roth_to, "roth"), g(tax_to, "taxable")
        client_trust_y2 = ({"roth": ct_roth_y2, "taxable": ct_tax_y2,
                            "total": ct_roth_y2 + ct_tax_y2} if funded_y1 > 0 else None)

        sv_roth_y2 = g(survivor_roth + roth_left, "roth") + orphans["roth"]
        sv_tax_y2 = g(survivor_taxable + tax_left, "taxable") + orphans["taxable"]
        sv_other_y2 = g(survivor_cash_house + client_cash_house, "cash_house") + orphans["cash_house"]
        sv_trad_y2 = g(trad_total, "traditional") + orphans["traditional"]
        estate_y2 = sv_roth_y2 + sv_tax_y2 + sv_other_y2 + sv_trad_y2
        survivor_y2 = {"roth": sv_roth_y2, "taxable": sv_tax_y2, "cash_house": sv_other_y2,
                       "traditional": sv_trad_y2, "total": estate_y2}

        cap_y2 = excl_y2 + dsue
        st_roth = st_tax = st_other = 0.0
        funding_y2 = None
        spouse_trust_y2 = None
        if key != "no_trust":
            st_roth, st_tax, _, _ = _fund(sv_roth_y2, sv_tax_y2, cap_y2, "roth_first")
            # House gets sold at 2nd death and rolled into the spouse GST trust up to
            # remaining exclusion in EVERY trust-funded plan (Plans 2/3/4). Only the
            # Traditional IRA flows outright to children.
            st_other = min(sv_other_y2, max(0.0, cap_y2 - st_roth - st_tax))
            funded_y2 = st_roth + st_tax + st_other
            offered_y2 = sv_roth_y2 + sv_tax_y2 + sv_other_y2
            funding_y2 = {
                "exclusion_limit": cap_y2,
                "fed_excl_y2": excl_y2,
                "dsue_component": dsue,
                "funding_assets": offered_y2,
                "roth_to_trust": st_roth,
                "taxable_to_trust": st_tax,
                "other_to_trust": st_other,
                "maximum_to_trust": funded_y2,
                "balance_over": max(0.0, offered_y2 - funded_y2),
                "gst_exempt_portion": min(funded_y2, excl_y2),
            }
            spouse_trust_y2 = {"roth": st_roth, "taxable": st_tax, "other": st_other,
                               "total": funded_y2}

        trust_funded_y2 = st_roth + st_tax + st_other
        outright_gross = estate_y2 - trust_funded_y2
        amount_over = max(0.0, estate_y2 - cap_y2)
        fet = amount_over * FED_ESTATE_TAX_RATE
        outright_net = max(0.0, outright_gross - fet)
        spill = max(0.0, fet - outright_gross)  # extreme case: tax exceeds outright pot
        client_trust_total = ct_roth_y2 + ct_tax_y2 if funded_y1 > 0 else 0.0
        spouse_trust_net = max(0.0, trust_funded_y2 - spill)
        trad_income_tax = sv_trad_y2 * max(0.0, heir_income_rate)
        total_to_children = client_trust_total + spouse_trust_net + outright_net

        children = {
            "outright_gross": outright_gross,
            "fet_limit": cap_y2,
            "amount_over": amount_over,
            "fet": fet,
            "outright_net": outright_net,
            "trad_income_tax": trad_income_tax,
            "total_to_children": total_to_children,
        }

        forgone_step_up = max(0.0, ct_tax_y2 - tax_to) * max(0.0, cap_gains_rate)
        gst_exempt_y2 = client_trust_total + (funding_y2 or {}).get("gst_exempt_portion", 0.0)
        lost_roth = max(0.0, total_roth_y2 - ct_roth_y2 - st_roth)

        metrics = {
            "in_trust_y2": client_trust_total + spouse_trust_net,
            "gst_exempt_y2": gst_exempt_y2,
            "fet": fet,
            "forgone_step_up": forgone_step_up,
            "lost_roth_unsheltered": lost_roth,
            "trad_income_tax": trad_income_tax,
            "total_to_children": total_to_children,
            "net_economic": total_to_children - forgone_step_up,
        }

        totals_y2 = {
            "roth": ct_roth_y2 + sv_roth_y2,
            "taxable": ct_tax_y2 + sv_tax_y2,
            "cash_house": sv_other_y2,
            "traditional": sv_trad_y2,
            "total": client_trust_total + estate_y2,
        }

        return {
            "key": key, "plan_no": plan_no, "title": title, "subtitle": subtitle,
            "funding_y1": funding_y1, "dsue": dsue,
            "client_trust_y2": client_trust_y2,
            "survivor_y2": survivor_y2,
            "funding_y2": funding_y2,
            "spouse_trust_y2": spouse_trust_y2,
            "children": children,
            "totals_y2": totals_y2,
            "metrics": metrics,
        }

    return {
        "first_death_year": first_death_year,
        "second_death_year": second_death_year,
        "years_between": yrs,
        "growth_rate": r,
        "growth_basis": "projection" if use_projection else "uniform",
        "implied_growth": implied_growth,
        "y2_reconciled_total": (round(sum(y2_map.values()), 2) if use_projection else None),
        "cap_gains_rate": cap_gains_rate,
        "heir_income_rate": heir_income_rate,
        "fed_excl_y1": excl_y1,
        "fed_excl_y2": excl_y2,
        "y1": y1,
        "plans": [run_plan(*p) for p in PLAN_DEFS],
    }
