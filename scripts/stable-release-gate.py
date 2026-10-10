"""Require recorded real-device acceptance before packaging a stable release."""
from pathlib import Path
import argparse
import math
import tomllib

REQUIRED = {
    "I01", "I02", "I03", "I04", "D01", "D02", "D03", "D04",
    "W01", "W02", "W03", "W04", "W05", "LONG_RUN",
}


def check_acceptance(document, root):
    errors = []
    if document.get("target_version") != "0.3.0":
        errors.append("Acceptance target must be 0.3.0")
    if document.get("candidate_version") != "0.3.0-rc.4":
        errors.append("Evidence must cover the current 0.3.0-rc.4 candidate")
    if type(document.get("unresolved_blockers")) is not int or document["unresolved_blockers"] != 0:
        errors.append("Unresolved blockers must explicitly be zero")
    cases = document.get("case", [])
    if not isinstance(cases, list) or any(not isinstance(case, dict) or not isinstance(case.get("id"), str) for case in cases):
        return errors + ["Acceptance cases must be a list of tables with string IDs"]
    ids = [case.get("id") for case in cases]
    if len(ids) != len(set(ids)):
        errors.append("Duplicate acceptance case IDs")
    for case_id in sorted(REQUIRED):
        case = next((c for c in cases if c.get("id") == case_id), None)
        if not case or case.get("status") != "passed":
            errors.append(case_id + ": real-device acceptance pending")
            continue
        for field in ("tester", "date", "environment", "result"):
            if not isinstance(case.get(field), str) or not case[field].strip():
                errors.append(case_id + ": missing " + field)
        evidence = case.get("evidence", [])
        if not isinstance(evidence, list) or not evidence:
            errors.append(case_id + ": missing evidence files")
            continue
        for name in evidence:
            if not isinstance(name, str) or not name:
                errors.append(case_id + ": invalid evidence path")
                continue
            path = (root / name).resolve()
            if not path.is_relative_to(root.resolve()) or not path.is_file() or path.stat().st_size == 0:
                errors.append(case_id + ": evidence missing or outside project: " + name)
        if case_id == "LONG_RUN" and (
            isinstance(case.get("duration_hours"), bool)
            or not isinstance(case.get("duration_hours"), (int, float))
            or not math.isfinite(case["duration_hours"])
            or case["duration_hours"] < 8
        ):
            errors.append("LONG_RUN: at least eight hours required")
    return errors


def main():
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--acceptance", type=Path, default=root / "docs/stable-acceptance.toml")
    args = parser.parse_args()
    try:
        document = tomllib.loads(args.acceptance.read_text(encoding="utf-8"))
        errors = check_acceptance(document, root)
    except (OSError, tomllib.TOMLDecodeError) as error:
        errors = ["Cannot read acceptance: " + str(error)]
    if errors:
        print("STABLE RELEASE BLOCKED")
        for error in errors:
            print("- " + error)
        return 1
    print("Stable acceptance records: PASS (real-device evidence still requires human review)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
