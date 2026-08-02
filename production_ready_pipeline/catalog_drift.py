#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


def stable_hash(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def load_catalog(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    trials = payload.get("trials") or []
    return {
        "path": str(path),
        "metadata": payload.get("metadata") or {},
        "hash": stable_hash(payload),
        "trials": {str(trial.get("nctId") or trial.get("id")): trial for trial in trials},
    }


def compare_catalogs(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    before_ids = set(before["trials"])
    after_ids = set(after["trials"])
    changed: list[dict[str, Any]] = []
    for trial_id in sorted(before_ids & after_ids):
        left = before["trials"][trial_id]
        right = after["trials"][trial_id]
        changes = []
        if left.get("status") != right.get("status"):
            changes.append({"field": "status", "before": left.get("status"), "after": right.get("status")})
        if stable_hash(left.get("criteria") or []) != stable_hash(right.get("criteria") or []):
            changes.append({"field": "criteria", "beforeHash": stable_hash(left.get("criteria") or []), "afterHash": stable_hash(right.get("criteria") or [])})
        if stable_hash(left.get("cohorts") or []) != stable_hash(right.get("cohorts") or []):
            changes.append({"field": "cohorts", "beforeHash": stable_hash(left.get("cohorts") or []), "afterHash": stable_hash(right.get("cohorts") or [])})
        if stable_hash(left.get("sites") or []) != stable_hash(right.get("sites") or []):
            changes.append({"field": "sites", "beforeHash": stable_hash(left.get("sites") or []), "afterHash": stable_hash(right.get("sites") or [])})
        if left.get("nccnTaxonomyVersion") != right.get("nccnTaxonomyVersion"):
            changes.append({"field": "taxonomyVersion", "before": left.get("nccnTaxonomyVersion"), "after": right.get("nccnTaxonomyVersion")})
        if changes:
            changed.append({"trialId": trial_id, "changes": changes})

    return {
        "schemaVersion": "1.0.0",
        "before": {"path": before["path"], "catalogHash": before["hash"], "trialSnapshot": before["metadata"].get("lastSyncAt")},
        "after": {"path": after["path"], "catalogHash": after["hash"], "trialSnapshot": after["metadata"].get("lastSyncAt")},
        "addedTrialIds": sorted(after_ids - before_ids),
        "removedTrialIds": sorted(before_ids - after_ids),
        "changedTrials": changed,
        "summary": {
            "added": len(after_ids - before_ids),
            "removed": len(before_ids - after_ids),
            "changed": len(changed),
            "statusChanges": sum(any(item["field"] == "status" for item in trial["changes"]) for trial in changed),
            "criteriaChanges": sum(any(item["field"] == "criteria" for item in trial["changes"]) for trial in changed),
            "cohortChanges": sum(any(item["field"] == "cohorts" for item in trial["changes"]) for trial in changed),
            "siteChanges": sum(any(item["field"] == "sites" for item in trial["changes"]) for trial in changed),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare immutable trial-catalog snapshots for status, criteria, cohort, site, and taxonomy drift.")
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    parser.add_argument("--fail-on-removed", action="store_true")
    parser.add_argument("--fail-on-unreviewed-change", action="store_true")
    args = parser.parse_args()
    report = compare_catalogs(load_catalog(args.before), load_catalog(args.after))
    print(json.dumps(report, indent=2))
    if args.fail_on_removed and report["summary"]["removed"]:
        return 1
    if args.fail_on_unreviewed_change and (report["summary"]["criteriaChanges"] or report["summary"]["cohortChanges"]):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
