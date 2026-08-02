// Utility functions for the clinical trials website

/**
 * Utility class with helper functions
 */
class Utils {
  
  /**
   * Format date for display
   * @param {string} dateString - ISO date string
   * @returns {string} Formatted date
   */
  static formatDate(dateString) {
    if (!dateString) return 'Not specified';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }

  /**
   * Format date for input fields
   * @param {string} dateString - ISO date string
   * @returns {string} Date in YYYY-MM-DD format
   */
  static formatDateForInput(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toISOString().split('T')[0];
  }

  /**
   * Get status display configuration
   * @param {string} status - Trial status
   * @returns {object} Status configuration
   */
  static normalizeStatus(status) {
    const normalized = (status || '').toString().trim().toLowerCase();
    const aliases = {
      recruiting: 'recruiting',
      ongoing: 'recruiting',
      active_not_recruiting: 'active_not_recruiting',
      'active, not recruiting': 'active_not_recruiting',
      upcoming: 'active_not_recruiting',
      completed: 'completed',
      past: 'completed',
      not_specified: 'not_specified',
      'not specified': 'not_specified',
      unspecified: 'not_specified',
      unknown: 'not_specified'
    };

    return aliases[normalized] || null;
  }

  static getStatusConfig(status) {
    const normalizedStatus = Utils.normalizeStatus(status) || 'not_specified';
    const configs = {
      recruiting: {
        label: 'Recruiting',
        className: 'recruiting',
        color: '#10b981'
      },
      active_not_recruiting: {
        label: 'Active, Not Recruiting',
        className: 'active-not-recruiting',
        color: '#2563eb'
      },
      completed: {
        label: 'Completed',
        className: 'completed',
        color: '#64748b'
      },
      not_specified: {
        label: 'Not specified',
        className: 'not-specified',
        color: '#64748b'
      }
    };

    return configs[normalizedStatus] || configs.not_specified;
  }

  static normalizeCancerType(cancerType) {
    const normalized = (cancerType || '').toString().trim().toLowerCase();
    const aliases = {
      prostate: 'Prostate',
      kidney: 'Kidney',
      renal: 'Kidney',
      'kidney/rcc': 'Kidney',
      bladder: 'Bladder',
      urothelial: 'Bladder',
      'bladder/urothelial': 'Bladder',
      testicular: 'Testicular',
      testis: 'Testicular',
      'testicular/gct': 'Testicular',
      adrenal: 'Adrenal',
      other: 'Others',
      others: 'Others'
    };

    return aliases[normalized] || null;
  }

  static inferCancerTypeFromText(text) {
    const haystack = (text || '').toString().toLowerCase();

    if (/(prostate|prostatic|mcrpc|castration-resistant prostate)/.test(haystack)) return 'Prostate';
    if (/(kidney|renal|rcc|renal cell carcinoma)/.test(haystack)) return 'Kidney';
    if (/(bladder|urothelial|nmibc|mibc)/.test(haystack)) return 'Bladder';
    if (/(testicular|testis|germ cell|seminoma)/.test(haystack)) return 'Testicular';
    if (/(adrenal|adrenocortical|pheochromocytoma|paraganglioma)/.test(haystack)) return 'Adrenal';

    return null;
  }

  static getTrialCancerType(trial) {
    const explicitType = Utils.normalizeCancerType(trial?.type || trial?.cancerType || trial?.cancerTypes?.[0]);
    if (explicitType) {
      return explicitType;
    }

    const eligibilityText = Array.isArray(trial?.eligibilityCriteria)
      ? trial.eligibilityCriteria.join(' ')
      : (trial?.eligibilityCriteria || '');

    return Utils.inferCancerTypeFromText([
      trial?.title,
      trial?.description,
      trial?.qualification,
      trial?.diseaseSettingPrimary,
      eligibilityText
    ].filter(Boolean).join(' '));
  }

  static normalizePhaseValue(phase) {
    const normalized = (phase || '').toString().trim().toUpperCase();
    const aliases = {
      EARLY_PHASE1: 'Early Phase I',
      PHASE1: 'Phase I',
      'PHASE1 | PHASE2': 'Phase I/II',
      PHASE2: 'Phase II',
      'PHASE2 | PHASE3': 'Phase II/III',
      PHASE3: 'Phase III',
      PHASE4: 'Phase IV',
      'N/A': 'Not specified',
      '': 'Not specified'
    };

    return aliases[normalized] || phase || 'Not specified';
  }

  static getDisplayPhase(trial) {
    return Utils.normalizePhaseValue(trial?.phaseRaw || trial?.phase);
  }

  /**
   * Truncate text to specified length
   * @param {string} text - Text to truncate
   * @param {number} maxLength - Maximum length
   * @returns {string} Truncated text
   */
  static truncateText(text, maxLength = 150) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
  }

  /**
   * Create unique ID
   * @returns {string} Unique identifier
   */
  static generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /**
   * Sanitize HTML to prevent XSS
   * @param {string} html - HTML string to sanitize
   * @returns {string} Sanitized HTML
   */
  static sanitizeHTML(html) {
    const div = document.createElement('div');
    div.textContent = html;
    return div.innerHTML;
  }

  /**
   * Debounce function calls
   * @param {Function} func - Function to debounce
   * @param {number} wait - Wait time in milliseconds
   * @returns {Function} Debounced function
   */
  static debounce(func, wait = 300) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  /**
   * Show loading state
   * @param {HTMLElement} element - Element to show loading in
   */
  static showLoading(element) {
    element.innerHTML = `
      <div class="loading-spinner">
        <div class="spinner"></div>
        <p>Loading...</p>
      </div>
    `;
  }

  /**
   * Show error state
   * @param {HTMLElement} element - Element to show error in
   * @param {string} message - Error message
   */
  static showError(element, message = 'An error occurred') {
    element.innerHTML = `
      <div class="error-state">
        <div class="error-icon">⚠️</div>
        <h3>Error</h3>
        <p>${Utils.sanitizeHTML(message)}</p>
      </div>
    `;
  }

  /**
   * Show success message
   * @param {string} message - Success message
   * @param {number} duration - Duration in milliseconds
   */
  static showSuccessMessage(message, duration = 3000) {
    const alertDiv = document.createElement('div');
    alertDiv.className = 'alert alert-success';
    alertDiv.textContent = message;
    alertDiv.style.position = 'fixed';
    alertDiv.style.top = '20px';
    alertDiv.style.right = '20px';
    alertDiv.style.zIndex = '1001';
    alertDiv.style.minWidth = '300px';
    
    document.body.appendChild(alertDiv);
    
    setTimeout(() => {
      alertDiv.style.opacity = '0';
      alertDiv.style.transform = 'translateX(100%)';
      setTimeout(() => {
        document.body.removeChild(alertDiv);
      }, 300);
    }, duration);
  }

  /**
   * Show error message
   * @param {string} message - Error message
   * @param {number} duration - Duration in milliseconds
   */
  static showErrorMessage(message, duration = 5000) {
    const alertDiv = document.createElement('div');
    alertDiv.className = 'alert alert-error';
    alertDiv.textContent = message;
    alertDiv.style.position = 'fixed';
    alertDiv.style.top = '20px';
    alertDiv.style.right = '20px';
    alertDiv.style.zIndex = '1001';
    alertDiv.style.minWidth = '300px';
    
    document.body.appendChild(alertDiv);
    
    setTimeout(() => {
      alertDiv.style.opacity = '0';
      alertDiv.style.transform = 'translateX(100%)';
      setTimeout(() => {
        if (document.body.contains(alertDiv)) {
          document.body.removeChild(alertDiv);
        }
      }, 300);
    }, duration);
  }

  /**
   * Get URL parameters
   * @returns {URLSearchParams} URL search parameters
   */
  static getUrlParams() {
    return new URLSearchParams(window.location.search);
  }

  /**
   * Update URL without refreshing page
   * @param {string} param - Parameter name
   * @param {string} value - Parameter value
   */
  static updateUrlParam(param, value) {
    const url = new URL(window.location);
    if (value) {
      url.searchParams.set(param, value);
    } else {
      url.searchParams.delete(param);
    }
    window.history.replaceState(null, '', url);
  }

  /**
   * Copy text to clipboard
   * @param {string} text - Text to copy
   * @returns {Promise<boolean>} Success status
   */
  static async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.error('Failed to copy text: ', err);
      return false;
    }
  }

  /**
   * Validate email format
   * @param {string} email - Email to validate
   * @returns {boolean} Validation result
   */
  static isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Format file size
   * @param {number} bytes - Size in bytes
   * @returns {string} Formatted size
   */
  static formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Check if element is in viewport
   * @param {HTMLElement} element - Element to check
   * @returns {boolean} Whether element is visible
   */
  static isInViewport(element) {
    const rect = element.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
  }

  /**
   * Smooth scroll to element
   * @param {HTMLElement|string} target - Element or selector to scroll to
   */
  static scrollToElement(target) {
    const element = typeof target === 'string' ? document.querySelector(target) : target;
    if (element) {
      element.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'start' 
      });
    }
  }

  /**
   * Get trial status based on dates
   * @param {string} startDate - Start date string
   * @param {string} endDate - End date string
   * @returns {string} Calculated status
   */
  static calculateTrialStatus(startDate, endDate) {
    const now = new Date();
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (now < start) {
      return 'active_not_recruiting';
    } else if (now > end) {
      return 'completed';
    } else {
      return 'recruiting';
    }
  }

  /**
   * Format duration string
   * @param {string} startDate - Start date
   * @param {string} endDate - End date
   * @returns {string} Duration description
   */
  static formatDuration(startDate, endDate) {
    if (!startDate || !endDate) return 'Duration not specified';
    
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const diffMonths = Math.round(diffDays / 30);
    
    if (diffMonths < 1) {
      return `${diffDays} days`;
    } else if (diffMonths < 12) {
      return `${diffMonths} months`;
    } else {
      const years = Math.round(diffMonths / 12);
      return `${years} year${years > 1 ? 's' : ''}`;
    }
  }

  static getDisplayWebsiteUpdate(trial) {
    return (trial?.lastWebsiteUpdate || trial?.lastSyncAt || trial?.lastUpdated || '').toString().trim();
  }

  static getDisplayInstituteId(trial) {
    return (trial?.instituteId || Utils.getPrimarySite(trial)?.institution || trial?.id || '').toString().trim();
  }

  static getTrialInstitutions(trial) {
    const institutions = [];
    if (Array.isArray(trial?.availableInstitutions)) {
      institutions.push(...trial.availableInstitutions);
    }
    if (Array.isArray(trial?.sites)) {
      trial.sites.forEach(site => {
        if (site?.institution) {
          institutions.push(site.institution);
        }
      });
    }
    if (trial?.location?.hospital) {
      institutions.push(trial.location.hospital);
    }

    return Array.from(new Set(
      institutions
        .map(value => (value || '').toString().trim())
        .filter(Boolean)
    )).sort();
  }

  static getPrimarySite(trial) {
    if (Array.isArray(trial?.sites) && trial.sites.length > 0) {
      return trial.sites[0];
    }

    return {
      institution: (trial?.location?.hospital || '').toString().trim(),
      city: (trial?.location?.city || '').toString().trim(),
      state: (trial?.location?.state || '').toString().trim(),
      address: (trial?.location?.address || '').toString().trim(),
      email: (trial?.contactEmail || '').toString().trim(),
      piName: (trial?.piName || '').toString().trim(),
      phone: '',
      affiliation: ''
    };
  }

  static getPrimaryContactEmail(trial) {
    return (trial?.contactEmail || Utils.getPrimarySite(trial)?.email || '').toString().trim();
  }

  static getPrimaryPiName(trial) {
    return (trial?.piName || Utils.getPrimarySite(trial)?.piName || '').toString().trim();
  }

  static getDiseaseSettingLabel(trial) {
    if (trial?.diseaseSettingPrimary) {
      return trial.diseaseSettingPrimary;
    }

    if (Array.isArray(trial?.diseaseSettingAll) && trial.diseaseSettingAll.length > 0) {
      return trial.diseaseSettingAll[0];
    }

    return (trial?.qualification || '').toString().trim();
  }

  static getDisplayCancerTypes(trial) {
    const cancerTypes = Array.isArray(trial?.cancerTypes) && trial.cancerTypes.length > 0
      ? trial.cancerTypes
      : [Utils.getTrialCancerType(trial)].filter(Boolean);
    return cancerTypes.join(', ') || 'Not specified';
  }

  static getTrialCsvHeaders() {
    return [
      'id',
      'nctId',
      'title',
      'status',
      'description',
      'hospital',
      'contactEmail',
      'startDate',
      'studyType',
      'phase',
      'phaseRaw',
      'cancerType',
      'cancerTypes',
      'type',
      'sponsor',
      'diseaseSettingPrimary',
      'diseaseSettingPrimaryId',
      'diseaseSettingAll',
      'diseaseSettingAllIds',
      'classificationConfidence',
      'classificationEvidence',
      'treatmentModality',
      'delivery',
      'clinicalAxes',
      'sourceTags',
      'nccnTaxonomyVersion',
      'ctGovUrl',
      'availableInstitutions',
      'inclusionCriteria',
      'exclusionCriteria',
      'primaryOutcomes',
      'secondaryOutcomes',
      'lastSyncAt',
      'pipelineVersion',
      'sourceRun',
      'primaryObjective',
      'secondaryObjectives',
      'eligibilityCriteria',
      'LastWebsiteUpdate',
      'InstituteID',
      'PI Name'
    ];
  }

  static escapeCsvCell(value) {
    const stringValue = value === null || value === undefined ? '' : String(value);
    if (/[",\n\r]/.test(stringValue)) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
  }

  static stringifyCsv(rows, headers = Utils.getTrialCsvHeaders()) {
    const csvLines = [];
    csvLines.push(headers.map(header => Utils.escapeCsvCell(header)).join(','));

    rows.forEach(row => {
      const line = headers.map(header => Utils.escapeCsvCell(row[header] ?? '')).join(',');
      csvLines.push(line);
    });

    return csvLines.join('\n');
  }

  static parseCsv(csvText) {
    const text = (csvText || '').toString().replace(/^\uFEFF/, '');
    if (!text.trim()) {
      return { headers: [], rows: [] };
    }

    const parsedRows = [];
    let currentCell = '';
    let currentRow = [];
    let insideQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
      const character = text[i];
      const nextCharacter = text[i + 1];

      if (character === '"') {
        if (insideQuotes && nextCharacter === '"') {
          currentCell += '"';
          i += 1;
        } else {
          insideQuotes = !insideQuotes;
        }
        continue;
      }

      if (character === ',' && !insideQuotes) {
        currentRow.push(currentCell);
        currentCell = '';
        continue;
      }

      if ((character === '\n' || character === '\r') && !insideQuotes) {
        if (character === '\r' && nextCharacter === '\n') {
          i += 1;
        }

        currentRow.push(currentCell);
        currentCell = '';

        const isEmptyRow = currentRow.every(cell => !cell || !cell.trim());
        if (!isEmptyRow) {
          parsedRows.push(currentRow);
        }
        currentRow = [];
        continue;
      }

      currentCell += character;
    }

    currentRow.push(currentCell);
    if (currentRow.some(cell => cell && cell.trim())) {
      parsedRows.push(currentRow);
    }

    if (parsedRows.length === 0) {
      return { headers: [], rows: [] };
    }

    const headers = parsedRows[0].map(header => (header || '').trim());
    const rows = parsedRows.slice(1).map((cells, index) => {
      const row = {};
      headers.forEach((header, headerIndex) => {
        if (header) {
          row[header] = (cells[headerIndex] || '').trim();
        }
      });
      row._rowNumber = index + 2;
      return row;
    });

    return { headers, rows };
  }

  static parsePipeSeparatedList(value) {
    return (value || '')
      .split('|')
      .map(item => item.trim())
      .filter(Boolean);
  }

  static parseJsonObject(value) {
    if (!value) {
      return {};
    }

    if (typeof value === 'object' && !Array.isArray(value)) {
      return value;
    }

    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  static formatPipeSeparatedList(values) {
    if (!Array.isArray(values)) {
      return '';
    }
    return values
      .map(item => (item || '').toString().trim())
      .filter(Boolean)
      .join(' | ');
  }

  static normalizeTrialForSave(trial) {
    const normalizedStatus = Utils.normalizeStatus(trial?.status);
    const normalizedCancerType = Utils.getTrialCancerType(trial);
    const normalizedCancerTypes = Array.isArray(trial?.cancerTypes)
      ? Array.from(new Set(
        trial.cancerTypes
          .map(item => Utils.normalizeCancerType(item))
          .filter(Boolean)
      ))
      : [normalizedCancerType].filter(Boolean);
    const institutions = Utils.getTrialInstitutions(trial);
    const primarySite = Utils.getPrimarySite(trial);
    const normalizedSites = Array.isArray(trial?.sites)
      ? trial.sites
        .filter(site => site && typeof site === 'object')
        .map(site => ({
          siteId: (site.siteId || '').toString().trim(),
          institution: (site.institution || '').toString().trim(),
          city: (site.city || '').toString().trim(),
          state: (site.state || '').toString().trim(),
          address: (site.address || '').toString().trim(),
          piName: (site.piName || '').toString().trim(),
          email: (site.email || '').toString().trim(),
          phone: (site.phone || '').toString().trim(),
          affiliation: (site.affiliation || '').toString().trim(),
          locationStatus: (site.locationStatus || site.status || 'unknown').toString().trim(),
          statusSource: (site.statusSource || 'not_available').toString().trim(),
          sourceVerifiedDate: site.sourceVerifiedDate || site.verifiedAt || null,
          ingestedAt: site.ingestedAt || null,
          manualStatus: site.manualStatus || null,
          statusStale: site.statusStale === true
        }))
      : [];
    const normalizedDiseaseSettingAll = Array.isArray(trial?.diseaseSettingAll)
      ? trial.diseaseSettingAll
        .map(item => (item === null || item === undefined ? '' : String(item).trim()))
        .filter(Boolean)
      : (trial?.diseaseSettingAll || '').toString().split('|').map(item => item.trim()).filter(Boolean);
    const normalizedDiseaseSettingAllIds = Array.isArray(trial?.diseaseSettingAllIds)
      ? trial.diseaseSettingAllIds
        .map(item => (item === null || item === undefined ? '' : String(item).trim()))
        .filter(Boolean)
      : [];
    const normalizeStringList = values => Array.isArray(values)
      ? values
        .map(item => (item === null || item === undefined ? '' : String(item).trim()))
        .filter(Boolean)
      : [];
    const normalizeStringMap = values => {
      const map = Utils.parseJsonObject(values);
      const normalized = {};

      Object.entries(map).forEach(([key, value]) => {
        const normalizedKey = (key || '').toString().trim();
        if (!normalizedKey) {
          return;
        }

        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const nested = {};
          Object.entries(value).forEach(([nestedKey, nestedValue]) => {
            const normalizedNestedKey = (nestedKey || '').toString().trim();
            const normalizedNestedValue = (nestedValue === null || nestedValue === undefined ? '' : String(nestedValue).trim());
            if (normalizedNestedKey && normalizedNestedValue) {
              nested[normalizedNestedKey] = normalizedNestedValue;
            }
          });
          if (Object.keys(nested).length > 0) {
            normalized[normalizedKey] = nested;
          }
          return;
        }

        const normalizedValue = (value === null || value === undefined ? '' : String(value).trim());
        if (normalizedValue) {
          normalized[normalizedKey] = normalizedValue;
        }
      });

      return normalized;
    };
    const normalizedClinicalAxes = normalizeStringMap(trial?.clinicalAxes);
    const normalizedSourceTags = normalizeStringMap(trial?.sourceTags);

    return {
      id: (trial?.id || '').toString().trim(),
      schemaVersion: (trial?.schemaVersion || '').toString().trim(),
      registry: (trial?.registry || '').toString().trim(),
      registryVersion: (trial?.registryVersion || '').toString().trim(),
      retrievedAt: (trial?.retrievedAt || '').toString().trim(),
      rawRecordHash: (trial?.rawRecordHash || '').toString().trim(),
      nctId: (trial?.nctId || '').toString().trim(),
      title: (trial?.title || '').toString().trim(),
      status: normalizedStatus || 'not_specified',
      description: (trial?.description || '').toString().trim(),
      qualification: (trial?.qualification || Utils.getDiseaseSettingLabel(trial) || '').toString().trim(),
      location: {
        hospital: (trial?.location?.hospital || primarySite.institution || '').toString().trim(),
        city: (trial?.location?.city || primarySite.city || '').toString().trim(),
        state: (trial?.location?.state || primarySite.state || '').toString().trim(),
        zipCode: (trial?.location?.zipCode || '').toString().trim(),
        address: (trial?.location?.address || primarySite.address || '').toString().trim()
      },
      contactEmail: Utils.getPrimaryContactEmail(trial),
      startDate: (trial?.startDate || '').toString().trim(),
      endDate: (trial?.endDate || '').toString().trim(),
      estimatedDuration: (trial?.estimatedDuration || '').toString().trim(),
      studyType: (trial?.studyType || '').toString().trim(),
      phase: Utils.getDisplayPhase(trial),
      phaseRaw: (trial?.phaseRaw || trial?.phase || '').toString().trim(),
      cancerType: normalizedCancerType || '',
      cancerTypes: normalizedCancerTypes,
      sponsor: (trial?.sponsor || '').toString().trim(),
      lastWebsiteUpdate: (trial?.lastWebsiteUpdate || trial?.lastSyncAt || '').toString().trim(),
      instituteId: (trial?.instituteId || '').toString().trim(),
      piName: Utils.getPrimaryPiName(trial),
      primaryObjective: (trial?.primaryObjective || '').toString().trim(),
      secondaryObjectives: Array.isArray(trial?.secondaryObjectives)
        ? trial.secondaryObjectives
          .map(item => (item === null || item === undefined ? '' : String(item).trim()))
          .filter(Boolean)
        : [],
      eligibilityCriteria: Array.isArray(trial?.eligibilityCriteria)
        ? trial.eligibilityCriteria
          .map(item => (item === null || item === undefined ? '' : String(item).trim()))
          .filter(Boolean)
        : [],
      lastUpdated: (trial?.lastUpdated || '').toString().trim(),
      diseaseSettingPrimary: (trial?.diseaseSettingPrimary || Utils.getDiseaseSettingLabel(trial) || '').toString().trim(),
      diseaseSettingPrimaryId: (trial?.diseaseSettingPrimaryId || '').toString().trim(),
      diseaseSettingAll: normalizedDiseaseSettingAll,
      diseaseSettingAllIds: normalizedDiseaseSettingAllIds,
      classificationConfidence: (trial?.classificationConfidence || '').toString().trim(),
      classificationEvidenceStrength: (trial?.classificationEvidenceStrength || trial?.classificationConfidence || '').toString().trim(),
      classificationIsProbability: trial?.classificationIsProbability === true,
      classificationMethod: (trial?.classificationMethod || '').toString().trim(),
      classificationEvidence: normalizeStringList(trial?.classificationEvidence),
      classificationFieldEvidence: Array.isArray(trial?.classificationFieldEvidence) ? trial.classificationFieldEvidence.map(item => ({ ...item })) : [],
      treatmentModality: (trial?.treatmentModality || '').toString().trim(),
      delivery: (trial?.delivery || '').toString().trim(),
      clinicalAxes: normalizedClinicalAxes,
      sourceTags: normalizedSourceTags,
      criteria: Array.isArray(trial?.criteria) ? trial.criteria.map(item => ({ ...item })) : [],
      cohorts: Array.isArray(trial?.cohorts) ? trial.cohorts.map(item => ({ ...item })) : [],
      dataQuality: trial?.dataQuality && typeof trial.dataQuality === 'object' ? { ...trial.dataQuality } : {},
      provenance: trial?.provenance && typeof trial.provenance === 'object' ? { ...trial.provenance } : {},
      nccnTaxonomyVersion: (trial?.nccnTaxonomyVersion || '').toString().trim(),
      ctGovUrl: (trial?.ctGovUrl || '').toString().trim(),
      conditions: normalizeStringList(trial?.conditions),
      interventions: normalizeStringList(trial?.interventions),
      availableInstitutions: institutions,
      siteCount: Number(trial?.siteCount || normalizedSites.length || institutions.length || 0),
      sites: normalizedSites,
      inclusionCriteria: (trial?.inclusionCriteria || '').toString().trim(),
      exclusionCriteria: (trial?.exclusionCriteria || '').toString().trim(),
      primaryOutcomes: normalizeStringList(trial?.primaryOutcomes),
      secondaryOutcomes: normalizeStringList(trial?.secondaryOutcomes),
      lastSyncAt: (trial?.lastSyncAt || '').toString().trim(),
      pipelineVersion: (trial?.pipelineVersion || '').toString().trim(),
      sourceRun: (trial?.sourceRun || '').toString().trim()
    };
  }

  static trialToCsvRow(trial) {
    const normalizedTrial = Utils.normalizeTrialForSave(trial);
    return {
      id: normalizedTrial.id,
      nctId: normalizedTrial.nctId,
      title: normalizedTrial.title,
      status: normalizedTrial.status === 'not_specified' ? '' : normalizedTrial.status,
      description: normalizedTrial.description,
      hospital: normalizedTrial.location.hospital,
      contactEmail: normalizedTrial.contactEmail,
      startDate: normalizedTrial.startDate,
      studyType: normalizedTrial.studyType,
      phase: normalizedTrial.phase,
      phaseRaw: normalizedTrial.phaseRaw,
      cancerType: normalizedTrial.cancerType,
      cancerTypes: Utils.formatPipeSeparatedList(normalizedTrial.cancerTypes),
      type: normalizedTrial.cancerType,
      sponsor: normalizedTrial.sponsor,
      diseaseSettingPrimary: normalizedTrial.diseaseSettingPrimary,
      diseaseSettingPrimaryId: normalizedTrial.diseaseSettingPrimaryId,
      diseaseSettingAll: Utils.formatPipeSeparatedList(normalizedTrial.diseaseSettingAll),
      diseaseSettingAllIds: Utils.formatPipeSeparatedList(normalizedTrial.diseaseSettingAllIds),
      classificationConfidence: normalizedTrial.classificationConfidence,
      classificationEvidence: Utils.formatPipeSeparatedList(normalizedTrial.classificationEvidence),
      treatmentModality: normalizedTrial.treatmentModality,
      delivery: normalizedTrial.delivery,
      clinicalAxes: JSON.stringify(normalizedTrial.clinicalAxes),
      sourceTags: JSON.stringify(normalizedTrial.sourceTags),
      nccnTaxonomyVersion: normalizedTrial.nccnTaxonomyVersion,
      ctGovUrl: normalizedTrial.ctGovUrl,
      availableInstitutions: Utils.formatPipeSeparatedList(normalizedTrial.availableInstitutions),
      inclusionCriteria: normalizedTrial.inclusionCriteria,
      exclusionCriteria: normalizedTrial.exclusionCriteria,
      primaryOutcomes: Utils.formatPipeSeparatedList(normalizedTrial.primaryOutcomes),
      secondaryOutcomes: Utils.formatPipeSeparatedList(normalizedTrial.secondaryOutcomes),
      lastSyncAt: normalizedTrial.lastSyncAt,
      pipelineVersion: normalizedTrial.pipelineVersion,
      sourceRun: normalizedTrial.sourceRun,
      primaryObjective: normalizedTrial.primaryObjective,
      secondaryObjectives: Utils.formatPipeSeparatedList(normalizedTrial.secondaryObjectives),
      eligibilityCriteria: Utils.formatPipeSeparatedList(normalizedTrial.eligibilityCriteria),
      LastWebsiteUpdate: normalizedTrial.lastWebsiteUpdate || normalizedTrial.lastUpdated,
      InstituteID: normalizedTrial.instituteId || normalizedTrial.id,
      'PI Name': normalizedTrial.piName
    };
  }

  static csvRowToTrial(row) {
    return Utils.normalizeTrialForSave({
      id: row?.id,
      nctId: row?.nctId,
      title: row?.title,
      status: row?.status,
      description: row?.description,
      qualification: row?.qualification,
      location: {
        hospital: row?.hospital,
        city: row?.city,
        state: row?.state,
        zipCode: row?.zipCode,
        address: row?.address
      },
      contactEmail: row?.contactEmail,
      startDate: row?.startDate,
      endDate: row?.endDate,
      estimatedDuration: row?.estimatedDuration,
      studyType: row?.studyType,
      phase: row?.phase,
      phaseRaw: row?.phaseRaw,
      cancerType: row?.type ?? row?.Type ?? row?.cancerType,
      cancerTypes: Utils.parsePipeSeparatedList(row?.cancerTypes),
      sponsor: row?.sponsor,
      diseaseSettingPrimary: row?.diseaseSettingPrimary,
      diseaseSettingPrimaryId: row?.diseaseSettingPrimaryId,
      diseaseSettingAll: Utils.parsePipeSeparatedList(row?.diseaseSettingAll),
      diseaseSettingAllIds: Utils.parsePipeSeparatedList(row?.diseaseSettingAllIds),
      classificationConfidence: row?.classificationConfidence,
      classificationEvidence: Utils.parsePipeSeparatedList(row?.classificationEvidence),
      treatmentModality: row?.treatmentModality,
      delivery: row?.delivery,
      clinicalAxes: Utils.parseJsonObject(row?.clinicalAxes),
      sourceTags: Utils.parseJsonObject(row?.sourceTags),
      nccnTaxonomyVersion: row?.nccnTaxonomyVersion,
      ctGovUrl: row?.ctGovUrl,
      availableInstitutions: Utils.parsePipeSeparatedList(row?.availableInstitutions),
      inclusionCriteria: row?.inclusionCriteria,
      exclusionCriteria: row?.exclusionCriteria,
      primaryOutcomes: Utils.parsePipeSeparatedList(row?.primaryOutcomes),
      secondaryOutcomes: Utils.parsePipeSeparatedList(row?.secondaryOutcomes),
      lastSyncAt: row?.lastSyncAt,
      pipelineVersion: row?.pipelineVersion,
      sourceRun: row?.sourceRun,
      lastWebsiteUpdate: row?.LastWebsiteUpdate ?? row?.lastWebsiteUpdate ?? row?.lastUpdated,
      instituteId: row?.InstituteID ?? row?.instituteId ?? row?.id,
      piName: row?.['PI Name'] ?? row?.piName,
      primaryObjective: row?.primaryObjective,
      secondaryObjectives: Utils.parsePipeSeparatedList(row?.secondaryObjectives),
      eligibilityCriteria: Utils.parsePipeSeparatedList(row?.eligibilityCriteria),
      lastUpdated: row?.lastUpdated
    });
  }

  /**
   * Create element from HTML string
   * @param {string} htmlString - HTML string
   * @returns {HTMLElement} Created element
   */
  static createElementFromHTML(htmlString) {
    const div = document.createElement('div');
    div.innerHTML = htmlString.trim();
    return div.firstChild;
  }

  /**
   * Remove all children from element
   * @param {HTMLElement} element - Element to clear
   */
  static clearElement(element) {
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }
}

// Export for use in other modules
window.Utils = Utils;
