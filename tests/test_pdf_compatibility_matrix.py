"""
Real-World PDF Compatibility & Non-Destructive Regression Test Suite.

Runs the full categorized corpus (real LibreOffice Writer/Calc, real Google Chrome
headless, plus clearly-tagged synthetic fixtures) and outputs `docs/compatibility_matrix.json`.
"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app import app
from tests.compat_fixtures import collect_all_fixtures
from tests.compat_runner import run_fixture_compatibility_check


client = TestClient(app)


def test_real_world_and_synthetic_compatibility_matrix(tmp_path: Path):
    fixtures = collect_all_fixtures()
    assert len(fixtures) >= 12

    results = []
    for fx in fixtures:
        rec = run_fixture_compatibility_check(client, fx, tmp_path)
        results.append(rec)

    matrix_path = Path(__file__).resolve().parent.parent / "docs" / "compatibility_matrix.json"
    matrix_path.parent.mkdir(parents=True, exist_ok=True)
    matrix_path.write_text(json.dumps(results, indent=2), encoding="utf-8")

    failures = [r for r in results if r["status"] in ("FAIL", "PARTIAL")]
    for f in failures:
        print(f"DEFECT FOUND [{f['status']}] {f['fixture_id']}: {f['issues']}")
    assert not failures, f"Compatibility defects discovered: {[(f['fixture_id'], f['status'], f['issues']) for f in failures]}"

