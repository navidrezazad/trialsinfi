from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor

import requests

try:
    from .app_config import ApiConfig
except ImportError:
    from app_config import ApiConfig


class ClinicalTrialsGovClient:
    def __init__(self, api_config: ApiConfig) -> None:
        self.api_config = api_config
        self.session = requests.Session()

    def _get(self, url: str, *, params: dict, timeout: int | None = None) -> dict:
        response = self.session.get(url, params=params, timeout=timeout or self.api_config.request_timeout)
        response.raise_for_status()
        return response.json()

    def query_studies(
        self,
        condition: str,
        *,
        fields: str | None = None,
        page_size: int | None = None,
        max_pages: int | None = 1,
        geo_filter: str | None = None,
        overall_status: tuple[str, ...] | None = None,
        study_type: str | None = None,
    ) -> list[dict]:
        params: dict[str, str | int] = {
            "query.cond": condition,
            "filter.overallStatus": "|".join(overall_status or self.api_config.statuses),
            "filter.advanced": f"AREA[StudyType]{study_type or self.api_config.study_type}",
            "pageSize": page_size or self.api_config.page_size,
            "format": "json",
        }
        if geo_filter:
            params["filter.geo"] = geo_filter
        if fields:
            params["fields"] = fields

        studies: list[dict] = []
        next_page_token: str | None = None
        page_number = 0
        seen_tokens: set[str] = set()

        while True:
            if next_page_token:
                params["pageToken"] = next_page_token
            data = self._get(self.api_config.base_url, params=params)
            if not isinstance(data.get("studies"), list):
                raise ValueError("Registry response is missing the studies array")
            studies.extend(data.get("studies", []))
            next_page_token = data.get("nextPageToken")
            page_number += 1
            if not next_page_token:
                break
            if next_page_token in seen_tokens:
                raise ValueError("Registry pagination repeated a page token; acquisition is incomplete")
            seen_tokens.add(next_page_token)
            if max_pages is not None and page_number >= max_pages:
                break
            time.sleep(self.api_config.polite_sleep_seconds)

        return studies

    def fetch_all(self, conditions: list[str]) -> list[dict]:
        if not conditions:
            raise ValueError("At least one registry query is required")
        seen_ncts: set[str] = set()
        all_studies: list[dict] = []
        lock = threading.Lock()

        def worker(condition: str) -> tuple[str, int]:
            try:
                studies = self.query_studies(
                    condition,
                    page_size=self.api_config.page_size,
                    max_pages=None,
                    geo_filter=self.api_config.geo_filter,
                    overall_status=self.api_config.statuses,
                    study_type=self.api_config.study_type,
                )
            except Exception:
                return condition, -1

            added = 0
            with lock:
                for study in studies:
                    nct_id = (
                        study.get("protocolSection", {})
                        .get("identificationModule", {})
                        .get("nctId", "")
                    )
                    if nct_id and nct_id not in seen_ncts:
                        seen_ncts.add(nct_id)
                        all_studies.append(study)
                        added += 1
            return condition, added

        with ThreadPoolExecutor(max_workers=self.api_config.max_workers) as pool:
            results = list(pool.map(worker, conditions))
        self.last_acquisition_manifest = {"queries": [{"condition": condition, "completed": count >= 0, "added": max(count, 0)} for condition, count in results]}
        failures = [condition for condition, count in results if count < 0]
        if failures:
            raise RuntimeError(f"Incomplete registry acquisition; retain previous catalog. Failed conditions: {failures}")

        return [
            study for study in all_studies
            if (
                study.get("protocolSection", {})
                .get("designModule", {})
                .get("studyType", "")
                .upper()
                == self.api_config.study_type
            )
            and (
                study.get("protocolSection", {})
                .get("statusModule", {})
                .get("overallStatus", "")
                in self.api_config.statuses
            )
        ]

    def fetch_study_status(self, nct_id: str) -> dict[str, str]:
        url = f"{self.api_config.base_url}/{nct_id}"
        data = self._get(
            url,
            params={"fields": "protocolSection.statusModule,protocolSection.identificationModule"},
            timeout=10,
        )
        protocol = data.get("protocolSection", {})
        status_module = protocol.get("statusModule", {})
        identification = protocol.get("identificationModule", {})
        return {
            "status": status_module.get("overallStatus", "UNKNOWN"),
            "why_stopped": status_module.get("whyStopped", ""),
            "title": identification.get("briefTitle", "") or identification.get("officialTitle", ""),
        }

    def fetch_study(self, nct_id: str, *, fields: str | None = None) -> dict:
        url = f"{self.api_config.base_url}/{nct_id}"
        params = {"fields": fields} if fields else {}
        return self._get(url, params=params, timeout=10)
