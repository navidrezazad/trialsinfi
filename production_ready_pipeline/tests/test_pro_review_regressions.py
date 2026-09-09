"""Offline regressions for the September Pro review; no patient data required."""
import copy
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from production_ready_pipeline.clinical_schema import _recognized_predicate, source_content_hash
from production_ready_pipeline.migrate_catalog_schema import migrate_catalog
from production_ready_pipeline.tests.test_curator_review import fixture, expect_failure
from production_ready_pipeline.api_client import ClinicalTrialsGovClient
from production_ready_pipeline.app_config import load_pipeline_config

def main():
    assert _recognized_predicate('ECOG < 1')[0]['operator'] == 'LT'
    assert _recognized_predicate('ECOG 0 or 2')[0]['value'] == [0, 2]
    assert _recognized_predicate('ECOG <= 1 and no active infection')[0] is None
    assert _recognized_predicate('Hemoglobin >= 9 g/dL within 7 days')[0] is None
    assert _recognized_predicate('Received anticancer therapy within 28 days')[0] is None
    assert _recognized_predicate('Hemoglobin >= 9 g/dL or platelets >= 100000/mm3')[0]['op'] == 'OR'
    catalog, review = fixture()
    changed = copy.deepcopy(catalog)
    changed['trials'][0]['inclusionCriteria'] += '\nNo active infection.'
    expect_failure(changed, review, 'actual source content changed')
    omitted = copy.deepcopy(review)
    omitted['cohorts'][0]['sharedCriterionIds'] = []
    expect_failure(catalog, omitted, 'every source criterion')
    migrated = migrate_catalog(catalog)
    trial = migrated['trials'][0]
    assert trial['sourceContentHash'] == source_content_hash(trial)
    again = migrate_catalog(migrated)
    assert again['trials'][0]['sourceContentHash'] == trial['sourceContentHash']
    # A reviewed closed cohort cannot inherit the parent's recruiting state.
    cohort = trial['cohorts'][0]
    cohort['cohortExtraction']['reviewedBy'] = 'test-reviewer'
    cohort['enrollmentStatus'] = 'closed'
    preserved = migrate_catalog(migrated)['trials'][0]
    assert preserved['cohorts'][0]['enrollmentStatus'] == 'closed'
    changed = copy.deepcopy(migrated)
    changed['trials'][0]['inclusionCriteria'] += '\nNo active infection.'
    rebuilt = migrate_catalog(changed)['trials'][0]
    assert not rebuilt['cohorts'][0]['cohortExtraction'].get('reviewedBy')
    config = load_pipeline_config(Path(__file__).resolve().parents[1])
    client = ClinicalTrialsGovClient(config.api)
    def query(condition, **kwargs):
        if condition == 'broken':
            raise RuntimeError('simulated registry failure')
        return []
    client.query_studies = query
    try:
        client.fetch_all(['prostate', 'broken'])
        raise AssertionError('Partial acquisition was accepted')
    except RuntimeError as error:
        assert 'Incomplete registry acquisition' in str(error)
    assert client.last_acquisition_manifest['queries'][1]['completed'] is False
    print('Pro-review pipeline regressions passed.')

if __name__ == '__main__':
    main()
