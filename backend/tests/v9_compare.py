"""Run the Python engine on V9 Scenario 1 and diff vs the spreadsheet actuals."""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from projection import run_projection  # noqa: E402
from v9_scenario1 import (V9_SCENARIO_1, V9_CONVERSIONS, V9_EOY,  # noqa: E402
                          V9_INCOME_TAX, V9_HEADLINE)


def pct(a, b):
    return 0.0 if b == 0 else (a - b) / b * 100


def main():
    out = run_projection(V9_SCENARIO_1)
    rows = {r["year"]: r for r in out["rows"]}
    s = out["summary"]
    leg = out["legacy"]

    print("=== CONVERSIONS (model vs V9) ===")
    print(f"{'yr':>5} {'model':>14} {'v9':>14} {'diff%':>8}")
    for y, v9c in V9_CONVERSIONS.items():
        m = rows[y]["roth_conversion"]
        print(f"{y:>5} {m:>14,.0f} {v9c:>14,.0f} {pct(m, v9c):>7.1f}%")

    print("\n=== EOY BALANCES (model vs V9): TradIRA | Roth | Cash+Taxable | NetWorth ===")
    for y, (trad, roth, ct, nw) in V9_EOY.items():
        r = rows[y]
        mct = r["cash"] + r["taxable"]
        print(f"{y}: trad {r['traditional']:>13,.0f}/{trad:>13,.0f} ({pct(r['traditional'],trad):>5.1f}%) | "
              f"roth {r['roth']:>13,.0f}/{roth:>13,.0f} ({pct(r['roth'],roth):>5.1f}%) | "
              f"c+t {mct:>13,.0f}/{ct:>13,.0f} ({pct(mct,ct):>5.1f}%) | "
              f"nw {r['net_worth']:>14,.0f}/{nw:>14,.0f} ({pct(r['net_worth'],nw):>5.1f}%)")

    print("\n=== INCOME TAX (model vs V9) ===")
    for y, v9t in V9_INCOME_TAX.items():
        m = rows[y]["total_tax"]
        print(f"{y}: {m:>13,.0f} / {v9t:>13,.0f}  (model total_tax incl. medicare)")

    print("\n=== HEADLINE METRICS ===")
    model_h = {
        "total_conversions": s["total_roth_converted"],
        "lifetime_income_taxes+medicare": s["lifetime_taxes"],
        "gross_estate": leg["gross_estate"],
        "trad_at_death": s["ending_traditional"],
        "heir_ira_tax_pv": round(s["ending_traditional"] * leg["heir_ordinary_rate"]),
        "after_tax_legacy_nominal": leg["after_tax_estate_at_death"],
        "children_wealth_plus10": leg["after_tax_estate_to_heirs"],
    }
    targets = {
        "total_conversions": V9_HEADLINE["total_conversions"],
        "lifetime_income_taxes+medicare": V9_HEADLINE["lifetime_income_taxes"] + V9_HEADLINE["lifetime_medicare"],
        "gross_estate": V9_HEADLINE["gross_estate"],
        "trad_at_death": V9_HEADLINE["trad_at_death"],
        "heir_ira_tax_pv": V9_HEADLINE["heir_ira_tax_pv"],
        "after_tax_legacy_nominal": V9_HEADLINE["after_tax_legacy_nominal"],
        "children_wealth_plus10": V9_HEADLINE["children_wealth_plus10"],
    }
    print(f"{'metric':>34} {'model':>16} {'v9':>16} {'diff%':>8}")
    for k in targets:
        m, t = model_h[k], targets[k]
        flag = "" if abs(pct(m, t)) <= 1.0 else "  <-- >1%"
        print(f"{k:>34} {m:>16,.0f} {t:>16,.0f} {pct(m,t):>7.1f}%{flag}")
    print(f"\nrows: {len(out['rows'])}, years modeled {out['rows'][0]['year']}-{out['rows'][-1]['year']}")


if __name__ == "__main__":
    main()
