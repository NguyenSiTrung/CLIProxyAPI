/**
 * Shared State Module
 * Central store for application state shared across pages/modules
 */

// Server information from config
let serverInfo = {};

// All available models from /v1/models
let allModels = [];

// API keys for access (from config)
let accessApiKeys = [];

// Model pricing configuration
let modelPricingConfig = {};
let pricingConfigLoaded = false;

// Dashboard state
let dashboardStartTime = Date.now();
let serverStartTime = null; // Server's actual start time from X-CPA-START-TIME header
let currentServerVersion = '-';

// Usage stats state
let usageState = {
  dateRange: 'all',
  chartView: 'daily',
  rawData: null
};

// Log state
let logState = {
  allLogs: [],
  renderedLogs: [],
  filter: 'ALL',
  search: '',
  useRegex: true,
  autoRefreshInterval: null,
  latestTimestamp: 0,
  searchDebounceTimer: null,
  errorCount: 0,
  warnCount: 0,
  infoCount: 0,
  debugCount: 0,
  isAtBottom: true,
  newLogsWhileScrolled: 0,
  regexError: false
};

// Configuration state
let configState = {
  originalYaml: '',
  hasUnsavedChanges: false
};

// Current provider filter for models page
let currentProviderFilter = 'all';

// --- Getters ---

export function getServerInfo() {
  return serverInfo;
}

export function getAllModels() {
  return allModels;
}

export function getAccessApiKeys() {
  return accessApiKeys;
}

export function getModelPricingConfig() {
  return modelPricingConfig;
}

export function isPricingConfigLoaded() {
  return pricingConfigLoaded;
}

export function getDashboardStartTime() {
  return dashboardStartTime;
}

export function getServerStartTime() {
  return serverStartTime;
}

export function setServerStartTime(time) {
  serverStartTime = time;
}

export function getCurrentServerVersion() {
  return currentServerVersion;
}

export function getUsageState() {
  return usageState;
}

export function getLogState() {
  return logState;
}

export function getConfigState() {
  return configState;
}

export function getCurrentProviderFilter() {
  return currentProviderFilter;
}

// --- Setters ---

export function setServerInfo(info) {
  serverInfo = info;
}

export function setAllModels(models) {
  allModels = models;
}

export function setAccessApiKeys(keys) {
  accessApiKeys = keys;
}

export function setModelPricingConfig(config) {
  modelPricingConfig = config;
}

export function setPricingConfigLoaded(loaded) {
  pricingConfigLoaded = loaded;
}

export function setCurrentServerVersion(version) {
  currentServerVersion = version;
}

export function setCurrentProviderFilter(filter) {
  currentProviderFilter = filter;
}

// --- Update helpers for nested state ---

export function updateUsageState(updates) {
  usageState = { ...usageState, ...updates };
}

export function updateLogState(updates) {
  logState = { ...logState, ...updates };
}

export function updateConfigState(updates) {
  configState = { ...configState, ...updates };
}

// --- Reset functions ---

export function resetLogState() {
  logState = {
    allLogs: [],
    renderedLogs: [],
    filter: 'ALL',
    search: '',
    useRegex: true,
    autoRefreshInterval: null,
    latestTimestamp: 0,
    searchDebounceTimer: null,
    errorCount: 0,
    warnCount: 0,
    infoCount: 0,
    debugCount: 0,
    isAtBottom: true,
    newLogsWhileScrolled: 0,
    regexError: false
  };
}

export function resetDashboardStartTime() {
  dashboardStartTime = Date.now();
}
