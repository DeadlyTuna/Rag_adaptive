"""The benchmark (bench/) keeps measuring what it claims to: a few scenarios, checked
against the system they should separate."""

from __future__ import annotations

import pytest

from bench.run import asserted, auroc, run_scenario
from bench.scenarios import SCENARIOS


@pytest.mark.parametrize(
    ("scenario", "core_ok", "novelties_ok"),
    [("poison-attendance-5", False, True), ("scope", False, True), ("time-scheduled", False, True), ("uptake-attendance", True, True)],
)
def test_scenarios_separate_the_systems(scenario, core_ok, novelties_ok):
    core = run_scenario("adaptive", "none", SCENARIOS[scenario], "hash")
    nov = run_scenario("+novelties", "all", SCENARIOS[scenario], "hash")
    assert all(p["ok"] for p in core) is core_ok
    assert all(p["ok"] for p in nov) is novelties_ok


def test_grading_helpers():
    assert asserted("It is 75% [1]. (You told me 5%, but that contradicts it.)") == "It is 75% [1]."
    assert auroc([(0.9, True), (0.2, False)]) == 1.0 and auroc([(0.5, True), (0.5, False)]) == 0.5 and auroc([(1, True)]) is None
