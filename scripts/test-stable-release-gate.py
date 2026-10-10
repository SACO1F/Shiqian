"""Check that missing acceptance cannot silently promote a candidate."""
from pathlib import Path
import importlib.util
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("stable_gate", Path(__file__).with_name("stable-release-gate.py"))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class StableGateTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / "evidence.txt").write_text("Synthetic gate fixture, not product acceptance")
        self.document = {
            "target_version": "0.3.0", "candidate_version": "0.3.0-rc.4", "unresolved_blockers": 0,
            "case": [{"id": case, "status": "passed", "tester": "fixture", "date": "2026-10-11",
                      "environment": "synthetic unit-test", "result": "fixture", "evidence": ["evidence.txt"],
                      "duration_hours": 8} for case in gate.REQUIRED],
        }

    def test_malformed_case_tables_are_blocked(self):
        for malformed in ("not tables", ["entry"], [{"id": ["I01"]}]):
            self.document["case"] = malformed
            self.assertTrue(gate.check_acceptance(self.document, self.root))

    def test_complete_record_structure(self):
        self.assertEqual(gate.check_acceptance(self.document, self.root), [])

    def test_pending_and_missing_cases(self):
        self.document["case"] = self.document["case"][:1]
        self.document["case"][0]["status"] = "pending"
        self.assertGreaterEqual(len(gate.check_acceptance(self.document, self.root)), len(gate.REQUIRED))

    def test_missing_evidence(self):
        (self.root / "evidence.txt").unlink()
        self.assertTrue(gate.check_acceptance(self.document, self.root))

    def test_escaped_evidence(self):
        self.document["case"][0]["evidence"] = ["../outside.txt"]
        self.assertTrue(gate.check_acceptance(self.document, self.root))

    def test_short_soak_is_not_eight_hours(self):
        next(c for c in self.document["case"] if c["id"] == "LONG_RUN")["duration_hours"] = 0.1
        self.assertTrue(gate.check_acceptance(self.document, self.root))

    def test_old_candidate_and_open_blockers(self):
        self.document["candidate_version"] = "0.3.0-beta.12"
        self.document["unresolved_blockers"] = 1
        self.assertGreaterEqual(len(gate.check_acceptance(self.document, self.root)), 2)

    def test_duplicates_and_blank_result(self):
        self.document["case"].append(self.document["case"][0].copy())
        self.document["case"][0]["result"] = ""
        self.assertGreaterEqual(len(gate.check_acceptance(self.document, self.root)), 2)


if __name__ == "__main__":
    unittest.main()
