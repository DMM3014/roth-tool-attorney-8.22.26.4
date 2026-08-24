"""Analyzer ↔ Client Report parity.

The Strategy Analyzer's sweep rows are assembled by strategy_optimizer._run_and_metrics,
which calls the SAME projection.run_projection the Client Report consumes. This test
proves there is no drift: one cfg is run through BOTH paths and the analyzer row is
asserted equal, to the dollar, to the report's legacy/summary figures.

Metric map (analyzer field  ↔  report figure):
  after_tax_estate   ↔  legacy.after_tax_estate_to_heirs  (report: "After-tax wealth to heirs (end of SECURE-10)")
  value_at_death     ↔  legacy.gross_estate                (report: gross estate / "Net worth at second death")
  ending_net_worth   ↔  summary.ending_net_worth           (report: net worth at 2nd death)
  lifetime_taxes     ↔  summary.lifetime_taxes              (report: lifetime taxes)

Also asserts the shared config fingerprint is deterministic and that the two
fingerprint views (full vs structural) behave as specified.
"""
import copy

from defaults import DEFAULT_SCENARIO
from projection import config_fingerprint, run_projection
from strategy_optimizer import _run_and_metrics


def _cfg():
    return copy.deepcopy(DEFAULT_SCENARIO)


def test_analyzer_row_matches_report_to_the_dollar():
    cfg = _cfg()

    # Report path — exactly what ClientReport consumes.
    report = run_projection(cfg)
    legacy = report["legacy"]
    summary = report["summary"]

    # Analyzer path — the sweep row assembly for the SAME cfg (baseline meta).
    row = _run_and_metrics(cfg, cfg, label="Parity", meta={"kind": "baseline"})

    assert row["after_tax_estate"] == legacy["after_tax_estate_to_heirs"]
    assert row["value_at_death"] == legacy["gross_estate"]
    assert row["ending_net_worth"] == summary["ending_net_worth"]
    assert row["lifetime_taxes"] == summary["lifetime_taxes"]
    # The at-death after-tax view is also shared verbatim.
    assert row["after_tax_estate_at_death"] == legacy.get("after_tax_estate_at_death", 0.0)


def test_config_fingerprint_is_deterministic_and_structural_ignores_swept_dims():
    cfg = _cfg()
    fp1 = config_fingerprint(cfg)
    fp2 = config_fingerprint(copy.deepcopy(cfg))
    # Deterministic hash across identical configs (timestamp aside).
    assert fp1["hash"] == fp2["hash"]
    assert fp1["structural_hash"] == fp2["structural_hash"]
    assert set(fp1["summary"]) >= {
        "total_starting_investable", "taxable_balance", "ira_balance",
        "funding_order", "conversion_window", "projection_years",
    }

    # Changing a SWEPT dimension (roth window / funding order) moves the full
    # hash but NOT the structural hash — so applying a leader never flags stale.
    swept = _cfg()
    swept["roth"]["end_year"] = (swept["roth"].get("end_year") or 2035) + 3
    swept.setdefault("withdrawal", {})["funding_order"] = "Cash → IRA → Taxable → Roth"
    fp_swept = config_fingerprint(swept)
    assert fp_swept["hash"] != fp1["hash"]
    assert fp_swept["structural_hash"] == fp1["structural_hash"]

    # Changing a STRUCTURAL input (an account balance) moves BOTH hashes.
    structural = _cfg()
    structural["accounts"][0]["beginning_balance"] = (
        (structural["accounts"][0].get("beginning_balance") or 0) + 100_000)
    fp_struct = config_fingerprint(structural)
    assert fp_struct["structural_hash"] != fp1["structural_hash"]
    assert fp_struct["hash"] != fp1["hash"]
