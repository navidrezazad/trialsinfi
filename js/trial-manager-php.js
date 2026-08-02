/**
 * Clinical Trial Manager - PHP backend version
 * Public reads remain unauthenticated; admin mutations use cookie sessions + CSRF.
 */
class TrialManager {
  constructor() {
    this.catalogVersion = '20260802-scientific-prescreen-r3';
    this.catalogRequestNonce = `${this.catalogVersion}-${Date.now()}`;
    this.trials = [];
    this.filteredTrials = [];
    this.currentPage = 1;
    this.trialsPerPage = 12;
    this.dataLoaded = false;
    this.apiUrl = `api/trials.php?v=${this.catalogRequestNonce}`;
    this.fallbackCatalogUrl = `data/trials.json?v=${this.catalogRequestNonce}`;
    this.authUrl = 'api/auth.php';
    this.csrfToken = '';
    this.catalogMetadata = {};
  }

  setCsrfToken(csrfToken) {
    this.csrfToken = csrfToken || '';
  }

  setAdminCredentials() {
    // Legacy no-op kept to avoid breaking older callers during the auth refactor.
  }

  async requestJson(url, options = {}) {
    const fetchOptions = {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        ...(options.headers || {})
      },
      ...options
    };

    const response = await fetch(url, fetchOptions);
    const data = await response.json().catch(() => ({
      success: false,
      message: 'Invalid server response.'
    }));

    if (!response.ok || data.success === false) {
      const error = new Error(data.message || `HTTP error ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  }

  normalizeTrialRecord(trial) {
    return Utils.normalizeTrialForSave(trial);
  }

  getStructuredCoverage(trials) {
    if (!Array.isArray(trials) || trials.length === 0) {
      return 0;
    }

    const withStructuredData = trials.filter(trial => {
      const primaryId = (trial?.diseaseSettingPrimaryId || '').toString().trim();
      const allIds = Array.isArray(trial?.diseaseSettingAllIds) ? trial.diseaseSettingAllIds.filter(Boolean) : [];
      const clinicalAxes = trial?.clinicalAxes && typeof trial.clinicalAxes === 'object'
        ? Object.keys(trial.clinicalAxes).filter(key => {
          const value = trial.clinicalAxes[key];
          return value !== null && value !== undefined && String(value).trim() !== '';
        })
        : [];

      return Boolean(primaryId || allIds.length || clinicalAxes.length);
    }).length;

    return withStructuredData / trials.length;
  }

  mergeStructuredFields(baseTrials, repairTrials) {
    const repairById = new Map((repairTrials || []).map(trial => [trial.id, trial]));

    return (baseTrials || []).map(trial => {
      const repaired = repairById.get(trial.id);
      if (!repaired) {
        return trial;
      }

      const merged = { ...trial };

      if (!merged.diseaseSettingPrimaryId && repaired.diseaseSettingPrimaryId) {
        merged.diseaseSettingPrimaryId = repaired.diseaseSettingPrimaryId;
      }

      if ((!Array.isArray(merged.diseaseSettingAllIds) || merged.diseaseSettingAllIds.length === 0) && Array.isArray(repaired.diseaseSettingAllIds) && repaired.diseaseSettingAllIds.length > 0) {
        merged.diseaseSettingAllIds = [...repaired.diseaseSettingAllIds];
      }

      if ((!merged.clinicalAxes || Object.keys(merged.clinicalAxes).length === 0) && repaired.clinicalAxes && Object.keys(repaired.clinicalAxes).length > 0) {
        merged.clinicalAxes = { ...repaired.clinicalAxes };
      }

      if ((!merged.sourceTags || Object.keys(merged.sourceTags).length === 0) && repaired.sourceTags && Object.keys(repaired.sourceTags).length > 0) {
        merged.sourceTags = { ...repaired.sourceTags };
      }

      return merged;
    });
  }

  async fetchCatalogPayload(url, options = {}) {
    const response = await fetch(url, {
      cache: 'reload',
      credentials: 'same-origin',
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        ...(options.headers || {})
      },
      ...options
    });

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }

    return response.json();
  }

  async attemptStructuredRepair(currentTrials, metadata = {}) {
    const currentCoverage = this.getStructuredCoverage(currentTrials);
    if (!Array.isArray(currentTrials) || currentTrials.length === 0) {
      return { trials: currentTrials, metadata };
    }
    const canonicalCatalog = String(metadata?.schemaVersion || '') === '1.0.0' && currentTrials.every(trial =>
      Array.isArray(trial?.cohorts) &&
      Array.isArray(trial?.criteria) &&
      trial?.provenance && typeof trial.provenance === 'object'
    );
    if (canonicalCatalog) {
      return { trials: currentTrials, metadata };
    }

    const repairNonce = `${this.catalogVersion}-repair-${Date.now()}`;
    const repairSources = [
      { url: `api/trials.php?v=${repairNonce}`, parser: data => ({ trials: (data.trials || []).map(trial => this.normalizeTrialRecord(trial)), metadata: data.metadata || {} }) },
      { url: `data/trials.json?v=${repairNonce}`, parser: data => ({ trials: (data.trials || []).map(trial => this.normalizeTrialRecord(trial)), metadata: data.metadata || {} }) }
    ];

    let bestTrials = currentTrials;
    let bestMetadata = metadata;
    let bestCoverage = currentCoverage;

    for (const source of repairSources) {
      try {
        const payload = await this.fetchCatalogPayload(source.url);
        const parsed = source.parser(payload);
        const mergedTrials = this.mergeStructuredFields(currentTrials, parsed.trials);
        const mergedCoverage = this.getStructuredCoverage(mergedTrials);

        if (mergedCoverage > bestCoverage) {
          bestTrials = mergedTrials;
          bestMetadata = Object.keys(parsed.metadata || {}).length > 0 ? parsed.metadata : bestMetadata;
          bestCoverage = mergedCoverage;
        }
      } catch (error) {
        console.warn('Structured catalog repair attempt failed:', source.url, error);
      }
    }

    return {
      trials: bestTrials,
      metadata: bestMetadata
    };
  }

  getLocationLabel(trial) {
    const institutions = Utils.getTrialInstitutions(trial);
    if (institutions.length > 1) {
      return `${institutions[0]} +${institutions.length - 1} more`;
    }
    return institutions[0] || trial.location?.city || Utils.getDisplayInstituteId(trial) || 'Not specified';
  }

  async loadTrials() {
    try {
      const data = await this.requestJson(this.apiUrl, {
        method: 'GET',
        headers: {}
      });

      const initialTrials = (data.trials || []).map(trial => this.normalizeTrialRecord(trial));
      const repaired = await this.attemptStructuredRepair(initialTrials, data.metadata || {});
      this.trials = repaired.trials;
      this.catalogMetadata = repaired.metadata || {};
      this.filteredTrials = [...this.trials];
      this.dataLoaded = true;
      return this.trials;
    } catch (error) {
      console.error('Error loading trials from server:', error);

      try {
        const fallbackResponse = await fetch(this.fallbackCatalogUrl, {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });

        if (fallbackResponse.ok) {
          const fallbackData = await fallbackResponse.json();
          const initialTrials = (fallbackData.trials || []).map(trial => this.normalizeTrialRecord(trial));
          const repaired = await this.attemptStructuredRepair(initialTrials, fallbackData.metadata || {});
          this.trials = repaired.trials;
          this.catalogMetadata = repaired.metadata || {};
          this.filteredTrials = [...this.trials];
          this.dataLoaded = true;
          return this.trials;
        }
      } catch (fallbackError) {
        console.error('Fallback trial load failed:', fallbackError);
      }

      Utils.showErrorMessage('Failed to load clinical trials data');
      return [];
    }
  }

  getAllTrials() {
    return this.trials;
  }

  getFilteredTrials() {
    return this.filteredTrials;
  }

  getTrialById(trialId) {
    return this.trials.find(trial => trial.id === trialId) || null;
  }

  getCurrentPageTrials() {
    const startIndex = (this.currentPage - 1) * this.trialsPerPage;
    return this.filteredTrials.slice(startIndex, startIndex + this.trialsPerPage);
  }

  getPaginationInfo() {
    const totalTrials = this.filteredTrials.length;
    const totalPages = Math.ceil(totalTrials / this.trialsPerPage);
    const startIndex = (this.currentPage - 1) * this.trialsPerPage + 1;
    const endIndex = Math.min(startIndex + this.trialsPerPage - 1, totalTrials);

    return {
      currentPage: this.currentPage,
      totalPages,
      totalTrials,
      startIndex: totalTrials > 0 ? startIndex : 0,
      endIndex: totalTrials > 0 ? endIndex : 0,
      hasNextPage: this.currentPage < totalPages,
      hasPrevPage: this.currentPage > 1
    };
  }

  setCurrentPage(page) {
    const totalPages = Math.ceil(this.filteredTrials.length / this.trialsPerPage);
    if (page >= 1 && page <= totalPages) {
      this.currentPage = page;
    }
  }

  applyFilters(filters) {
    const statusFilter = filters.status && filters.status !== 'all'
      ? (Utils.normalizeStatus(filters.status) || 'all')
      : 'all';
    const selectedLocations = Array.isArray(filters.locations)
      ? filters.locations.filter(location => location && location !== 'all')
      : (filters.location && filters.location !== 'all' ? [filters.location] : []);
    const phaseFilter = filters.phase || 'all';
    const cancerTypeFilter = filters.cancerType && filters.cancerType !== 'all'
      ? Utils.normalizeCancerType(filters.cancerType)
      : null;

    this.filteredTrials = this.trials.filter(trial => {
      const trialStatus = Utils.normalizeStatus(trial.status) || 'not_specified';

      if (statusFilter !== 'all' && trialStatus !== statusFilter) {
        return false;
      }

      if (selectedLocations.length > 0) {
        const institutions = Utils.getTrialInstitutions(trial).map(location => location.toLowerCase());
        const matched = selectedLocations.some(location =>
          institutions.some(institution => institution.includes(location.toLowerCase()))
        );
        if (!matched) {
          return false;
        }
      }

      if (phaseFilter !== 'all' && !this.matchesPhaseFilter(Utils.getDisplayPhase(trial), phaseFilter)) {
        return false;
      }

      if (cancerTypeFilter && Utils.getTrialCancerType(trial) !== cancerTypeFilter) {
        return false;
      }

      if (filters.searchQuery && filters.searchQuery.trim()) {
        const query = filters.searchQuery.toLowerCase().trim();
        const searchableFields = [
          trial.title,
          trial.description,
          trial.qualification,
          trial.location?.hospital || '',
          trial.location?.city || '',
          Utils.getPrimaryPiName(trial),
          Utils.getDisplayInstituteId(trial),
          trial.primaryObjective,
          trial.diseaseSettingPrimary || '',
          ...(Array.isArray(trial.diseaseSettingAll) ? trial.diseaseSettingAll : []),
          trial.treatmentModality || '',
          ...(Array.isArray(trial.availableInstitutions) ? trial.availableInstitutions : []),
          ...(Array.isArray(trial.conditions) ? trial.conditions : []),
          trial.sponsor,
          trial.cancerType || '',
          ...(Array.isArray(trial.cancerTypes) ? trial.cancerTypes : [])
        ].join(' ').toLowerCase();

        if (!searchableFields.includes(query)) {
          return false;
        }
      }

      return true;
    });

    if (filters.sortBy) {
      this.sortTrials(filters.sortBy);
    }

    this.currentPage = 1;
  }

  matchesPhaseFilter(trialPhase, selectedPhase) {
    const phase = Utils.normalizePhaseValue(trialPhase);

    if (!phase || phase === 'Not specified') {
      return false;
    }

    if (selectedPhase === 'Phase I') {
      return phase === 'Phase I' || phase === 'Phase I/II' || phase === 'Early Phase I';
    }

    if (selectedPhase === 'Phase II') {
      return phase === 'Phase II' || phase === 'Phase I/II';
    }

    return phase === selectedPhase;
  }

  sortTrials(sortBy) {
    this.filteredTrials.sort((a, b) => {
      switch (sortBy) {
        case 'title':
          return a.title.localeCompare(b.title);
        case 'status': {
          const order = {
            recruiting: 1,
            active_not_recruiting: 2,
            completed: 3
          };
          return (order[Utils.normalizeStatus(a.status)] || 99) - (order[Utils.normalizeStatus(b.status)] || 99);
        }
        case 'startDate':
          return new Date(b.startDate) - new Date(a.startDate);
        case 'location':
          return (Utils.getTrialInstitutions(a)[0] || this.getLocationLabel(a))
            .localeCompare(Utils.getTrialInstitutions(b)[0] || this.getLocationLabel(b));
        default:
          return 0;
      }
    });
  }

  searchTrials(query) {
    if (!query || !query.trim()) {
      return this.trials;
    }

    const searchTerms = query.toLowerCase().trim().split(' ');
    return this.trials.filter(trial => {
      const searchableContent = [
        trial.title,
        trial.description,
        trial.qualification,
        trial.location?.hospital || '',
        trial.location?.city || '',
        Utils.getPrimaryPiName(trial),
        Utils.getDisplayInstituteId(trial),
        trial.primaryObjective,
        trial.diseaseSettingPrimary || '',
        ...(Array.isArray(trial.diseaseSettingAll) ? trial.diseaseSettingAll : []),
        trial.treatmentModality || '',
        ...(Array.isArray(trial.availableInstitutions) ? trial.availableInstitutions : []),
        ...(Array.isArray(trial.conditions) ? trial.conditions : []),
        trial.sponsor,
        ...(Array.isArray(trial.eligibilityCriteria) ? trial.eligibilityCriteria : []),
        ...(Array.isArray(trial.secondaryObjectives) ? trial.secondaryObjectives : []),
        ...(Array.isArray(trial.secondaryOutcomes) ? trial.secondaryOutcomes : [])
      ].join(' ').toLowerCase();

      return searchTerms.every(term => searchableContent.includes(term));
    });
  }

  getTrialsByStatus(status) {
    const normalizedStatus = Utils.normalizeStatus(status);
    return this.trials.filter(trial => Utils.normalizeStatus(trial.status) === normalizedStatus);
  }

  getTrialsByLocation(location) {
    return this.trials.filter(trial => this.getLocationLabel(trial).toLowerCase().includes(location.toLowerCase()));
  }

  getUniqueLocations() {
    const locations = new Set();
    this.trials.forEach(trial => {
      Utils.getTrialInstitutions(trial).forEach(location => locations.add(location));
    });
    return Array.from(locations).sort();
  }

  getUniqueStudyTypes() {
    const studyTypes = new Set();
    this.trials.forEach(trial => {
      if (trial.studyType) {
        studyTypes.add(trial.studyType);
      }
    });
    return Array.from(studyTypes).sort();
  }

  getTrialsStatistics() {
    const stats = {
      total: this.trials.length,
      recruiting: 0,
      active_not_recruiting: 0,
      completed: 0,
      not_specified: 0,
      byLocation: {},
      byStudyType: {}
    };

    this.trials.forEach(trial => {
      const status = Utils.normalizeStatus(trial.status) || 'not_specified';
      if (Object.prototype.hasOwnProperty.call(stats, status)) {
        stats[status] += 1;
      }

      const locationLabel = this.getLocationLabel(trial);
      stats.byLocation[locationLabel] = (stats.byLocation[locationLabel] || 0) + 1;

      if (trial.studyType) {
        stats.byStudyType[trial.studyType] = (stats.byStudyType[trial.studyType] || 0) + 1;
      }
    });

    return stats;
  }

  buildMutationHeaders() {
    if (!this.csrfToken) {
      throw new Error('Missing CSRF token. Refresh the page and sign in again.');
    }

    return {
      'X-CSRF-Token': this.csrfToken
    };
  }

  async addTrial(trialData) {
    const payload = {
      trial: Utils.normalizeTrialForSave(trialData)
    };

    const data = await this.requestJson(this.apiUrl, {
      method: 'POST',
      headers: this.buildMutationHeaders(),
      body: JSON.stringify(payload)
    });

    this.catalogMetadata = data.metadata || this.catalogMetadata;
    this.trials.unshift(this.normalizeTrialRecord(data.trial));
    this.filteredTrials = [...this.trials];
    return true;
  }

  async updateTrial(trialId, updatedData) {
    const payload = {
      id: trialId,
      trial: Utils.normalizeTrialForSave(updatedData)
    };

    const data = await this.requestJson(this.apiUrl, {
      method: 'PUT',
      headers: this.buildMutationHeaders(),
      body: JSON.stringify(payload)
    });

    this.catalogMetadata = data.metadata || this.catalogMetadata;
    const trialIndex = this.trials.findIndex(trial => trial.id === trialId);
    if (trialIndex !== -1) {
      this.trials[trialIndex] = this.normalizeTrialRecord(data.trial);
      this.filteredTrials = [...this.trials];
    }

    return true;
  }

  async deleteTrial(trialId) {
    const data = await this.requestJson(this.apiUrl, {
      method: 'DELETE',
      headers: this.buildMutationHeaders(),
      body: JSON.stringify({ id: trialId })
    });

    this.catalogMetadata = data.metadata || this.catalogMetadata;
    const trialIndex = this.trials.findIndex(trial => trial.id === trialId);
    if (trialIndex !== -1) {
      this.trials.splice(trialIndex, 1);
      this.filteredTrials = [...this.trials];
    }

    return true;
  }

  async replaceTrialsFromCsv(rows) {
    const data = await this.requestJson(this.apiUrl, {
      method: 'POST',
      headers: this.buildMutationHeaders(),
      body: JSON.stringify({
        action: 'bulk_replace',
        source: 'csv',
        rows
      })
    });

    this.catalogMetadata = data.metadata || this.catalogMetadata;
    this.trials = (data.trials || []).map(trial => this.normalizeTrialRecord(trial));
    this.filteredTrials = [...this.trials];
    return data;
  }

  async bulkUpsertTrials(rows) {
    return this.replaceTrialsFromCsv(rows);
  }

  async authenticateAdmin(username, password) {
    try {
      const data = await this.requestJson(`${this.authUrl}?action=admin_login`, {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      this.setCsrfToken(data.csrfToken || '');
      return true;
    } catch (error) {
      console.error('Authentication error:', error);
      return false;
    }
  }

  exportTrials() {
    return JSON.stringify({
      trials: this.trials,
      exportDate: new Date().toISOString(),
      totalTrials: this.trials.length
    }, null, 2);
  }

  importTrials(jsonData) {
    try {
      const data = JSON.parse(jsonData);
      return Array.isArray(data?.trials);
    } catch (error) {
      console.error('Import parse error:', error);
      return false;
    }
  }

  saveTrialsToStorage() {
    console.log('Data is persisted on the server for the PHP version.');
  }

  loadTrialsFromStorage() {
    return false;
  }

  async resetTrials() {
    await this.loadTrials();
  }
}

if (typeof window !== 'undefined') window.TrialManager = TrialManager;
if (typeof module !== 'undefined' && module.exports) module.exports = TrialManager;
