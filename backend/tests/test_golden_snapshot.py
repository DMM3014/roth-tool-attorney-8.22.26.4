"""Regression guard (pytest): the tax engine + projection outputs must match the
committed golden baseline to the cent. This auto-protects every future refactor —
any behavioral drift fails CI. It runs fully offline (calls run_projection directly,
no live backend needed).

If a change to the tax math is INTENTIONAL, refresh the baseline and review the diff:
    python tests/golden_snapshot.py save
"""
import json
import os

import pytest

from tests import golden_snapshot as gs


def test_golden_snapshot_matches_baseline():
    assert os.path.exists(gs.GOLDEN), (
        "Missing golden baseline. Create it once with: python tests/golden_snapshot.py save"
    )
    current = json.dumps(gs.build(), sort_keys=True, default=str)
    with open(gs.GOLDEN) as fh:
        baseline = fh.read()
    if current == baseline:
        return

    cur, base = json.loads(current), json.loads(baseline)
    drifted = [
        section for section in ("year_tax", "optimize", "projection", "montecarlo")
        if json.dumps(base.get(section), sort_keys=True, default=str)
        != json.dumps(cur.get(section), sort_keys=True, default=str)
    ]
    pytest.fail(
        "Tax-engine / projection / Monte Carlo output drifted from the golden baseline in section(s): "
        + ", ".join(drifted)
        + ". If this change is intentional, refresh the baseline with "
        "`python tests/golden_snapshot.py save` and review the diff before committing."
    )
