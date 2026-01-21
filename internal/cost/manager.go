// Package cost provides cost calculation and tracking for API requests.
package cost

import (
	"path/filepath"
	"sync"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
	coreusage "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/usage"
)

const accumulatorFileName = "cost_accumulator.json"
const requestAccumulatorFileName = "request_accumulator.json"
const autoResetStateFileName = "auto_reset_state.json"

// Manager combines config, calculator, and accumulator to provide
// a unified interface for cost limit management.
type Manager struct {
	mu                 sync.RWMutex
	cfg                *config.Config
	calculator         *Calculator
	accumulator        *Accumulator
	requestAccumulator *RequestAccumulator
	autoResetScheduler *AutoResetScheduler
	dataDir            string
}

// NewManager creates a new cost limit manager.
// It loads existing accumulated costs from the data directory if available.
func NewManager(cfg *config.Config, dataDir string) *Manager {
	stateFile := ""
	if dataDir != "" {
		stateFile = filepath.Join(dataDir, autoResetStateFileName)
	}

	m := &Manager{
		cfg:                cfg,
		calculator:         NewCalculator(),
		accumulator:        NewAccumulator(),
		requestAccumulator: NewRequestAccumulator(),
		autoResetScheduler: NewAutoResetScheduler(stateFile, time.Minute),
		dataDir:            dataDir,
	}
	if dataDir != "" {
		_ = m.accumulator.LoadFromFile(filepath.Join(dataDir, accumulatorFileName))
		_ = m.requestAccumulator.LoadFromFile(filepath.Join(dataDir, requestAccumulatorFileName))
	}
	return m
}

// IsEnabled returns whether cost limit enforcement is active.
func (m *Manager) IsEnabled() bool {
	if m == nil || m.cfg == nil {
		return false
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.cfg.AccessKeyLimits.Enabled
}

// SetEnabled updates the enabled state of cost limits.
func (m *Manager) SetEnabled(enabled bool) {
	if m == nil || m.cfg == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cfg.AccessKeyLimits.Enabled = enabled
}

// CountOnlySuccessRequests returns whether only successful requests are counted.
func (m *Manager) CountOnlySuccessRequests() bool {
	if m == nil || m.cfg == nil {
		return false
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.cfg.AccessKeyLimits.CountOnlySuccessRequests
}

// SetCountOnlySuccessRequests updates whether only successful requests are counted.
func (m *Manager) SetCountOnlySuccessRequests(value bool) {
	if m == nil || m.cfg == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cfg.AccessKeyLimits.CountOnlySuccessRequests = value
}

// SetConfig updates the config reference for hot-reload support.
func (m *Manager) SetConfig(cfg *config.Config) {
	if m == nil || cfg == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cfg = cfg
}

// GetLimit returns the cost limit for an API key.
// If the key has a specific limit configured, that is returned.
// Otherwise, the default limit is returned.
// A limit of 0 means unlimited.
func (m *Manager) GetLimit(apiKey string) float64 {
	if m == nil || m.cfg == nil {
		return 0
	}
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, keyLimit := range m.cfg.AccessKeyLimits.Keys {
		if keyLimit.APIKey == apiKey {
			return keyLimit.MaxCost
		}
	}
	return m.cfg.AccessKeyLimits.DefaultMaxCost
}

// GetRequestLimit returns the request count limit for an API key.
// If the key has a specific limit configured, that is returned.
// Otherwise, the default limit is returned.
// A limit of 0 means unlimited.
func (m *Manager) GetRequestLimit(apiKey string) int64 {
	if m == nil || m.cfg == nil {
		return 0
	}
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, keyLimit := range m.cfg.AccessKeyLimits.Keys {
		if keyLimit.APIKey == apiKey {
			return keyLimit.MaxRequests
		}
	}
	return m.cfg.AccessKeyLimits.DefaultMaxRequests
}

// SetLimit updates the cost limit for a specific API key.
func (m *Manager) SetLimit(apiKey string, maxCost float64) {
	if m == nil || m.cfg == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()

	for i, keyLimit := range m.cfg.AccessKeyLimits.Keys {
		if keyLimit.APIKey == apiKey {
			m.cfg.AccessKeyLimits.Keys[i].MaxCost = maxCost
			return
		}
	}
	m.cfg.AccessKeyLimits.Keys = append(m.cfg.AccessKeyLimits.Keys, config.AccessKeyLimit{
		APIKey:  apiKey,
		MaxCost: maxCost,
	})
}

// SetRequestLimit updates the request count limit for a specific API key.
func (m *Manager) SetRequestLimit(apiKey string, maxRequests int64) {
	if m == nil || m.cfg == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()

	for i, keyLimit := range m.cfg.AccessKeyLimits.Keys {
		if keyLimit.APIKey == apiKey {
			m.cfg.AccessKeyLimits.Keys[i].MaxRequests = maxRequests
			return
		}
	}
	m.cfg.AccessKeyLimits.Keys = append(m.cfg.AccessKeyLimits.Keys, config.AccessKeyLimit{
		APIKey:      apiKey,
		MaxRequests: maxRequests,
	})
}

// RemoveLimit removes a key's limit configuration and clears its accumulated data.
// It removes the key from the config's AccessKeyLimits.Keys slice and deletes
// accumulated cost/request data from the accumulators.
// For multi-tier quotas, removes all tier data using prefix scan (robust even if config already removed).
func (m *Manager) RemoveLimit(apiKey string) {
	if m == nil || m.cfg == nil {
		return
	}
	m.mu.Lock()

	// Remove from config keys
	keys := m.cfg.AccessKeyLimits.Keys
	for i := range keys {
		if keys[i].APIKey == apiKey {
			m.cfg.AccessKeyLimits.Keys = append(keys[:i], keys[i+1:]...)
			break
		}
	}
	m.mu.Unlock()

	// Delete accumulated data - legacy/base key
	m.accumulator.Delete(apiKey)
	m.requestAccumulator.Delete(apiKey)

	// Delete tier data by prefix scan (works even if config entry was already removed)
	prefix := apiKey + TierKeyDelimiter
	for k := range m.accumulator.GetAll() {
		if len(k) > len(prefix) && k[:len(prefix)] == prefix {
			m.accumulator.Delete(k)
			if m.autoResetScheduler != nil {
				m.autoResetScheduler.Cancel(k)
			}
		}
	}
	for k := range m.requestAccumulator.GetAll() {
		if len(k) > len(prefix) && k[:len(prefix)] == prefix {
			m.requestAccumulator.Delete(k)
			if m.autoResetScheduler != nil {
				m.autoResetScheduler.Cancel(k)
			}
		}
	}

	// Remove base key from auto-reset scheduler
	if m.autoResetScheduler != nil {
		m.autoResetScheduler.Cancel(apiKey)
	}
}

// LimitExceededType indicates which limit type was exceeded.
type LimitExceededType string

const (
	LimitNone    LimitExceededType = "none"
	LimitCost    LimitExceededType = "cost"
	LimitRequest LimitExceededType = "request"
)

// CheckLimitResult contains detailed information about limit check results.
type CheckLimitResult struct {
	Allowed         bool              // whether the request is allowed
	Exceeded        LimitExceededType // which limit type was exceeded
	CurrentCost     float64           // current cost (for the exceeded tier, or first tier)
	CostLimit       float64           // cost limit (for the exceeded tier, or first tier)
	CurrentRequests int64             // current requests (for the exceeded tier, or first tier)
	RequestLimit    int64             // request limit (for the exceeded tier, or first tier)
	TierID          string            // tier ID that was exceeded (empty for legacy mode)
}

// CheckLimit checks if an API key is within both cost and request limits.
// Returns whether the key is allowed to make requests, the current accumulated cost,
// the configured cost limit, and which limit type was exceeded (if any).
// For multi-tier quotas, checks ALL tiers and blocks if ANY tier is exceeded.
func (m *Manager) CheckLimit(apiKey string) (allowed bool, currentCost float64, costLimit float64, exceeded LimitExceededType) {
	result := m.CheckLimitDetailed(apiKey)
	return result.Allowed, result.CurrentCost, result.CostLimit, result.Exceeded
}

// CheckLimitDetailed checks all quota tiers and returns detailed results.
// For multi-tier quotas, checks ALL tiers and blocks if ANY tier is exceeded.
func (m *Manager) CheckLimitDetailed(apiKey string) CheckLimitResult {
	if m == nil {
		return CheckLimitResult{Allowed: true}
	}
	if !m.IsEnabled() {
		return CheckLimitResult{Allowed: true}
	}

	rules := m.resolveRules(apiKey)
	if len(rules) == 0 {
		return CheckLimitResult{Allowed: true}
	}

	// Check all tiers - block if ANY tier is exceeded
	// Check cost limits first, then request limits (existing precedence)
	for _, rule := range rules {
		if rule.maxCost > 0 {
			current := m.accumulator.Get(rule.key)
			if current >= rule.maxCost {
				return CheckLimitResult{
					Allowed:     false,
					Exceeded:    LimitCost,
					CurrentCost: current,
					CostLimit:   rule.maxCost,
					TierID:      rule.id,
				}
			}
		}
	}

	for _, rule := range rules {
		if rule.maxReq > 0 {
			current := m.requestAccumulator.Get(rule.key)
			if current >= rule.maxReq {
				// Get cost info from first rule for backward compatibility
				firstCost := m.accumulator.Get(rules[0].key)
				return CheckLimitResult{
					Allowed:         false,
					Exceeded:        LimitRequest,
					CurrentCost:     firstCost,
					CostLimit:       rules[0].maxCost,
					CurrentRequests: current,
					RequestLimit:    rule.maxReq,
					TierID:          rule.id,
				}
			}
		}
	}

	// All tiers OK - return first tier's values for backward compatibility
	return CheckLimitResult{
		Allowed:         true,
		Exceeded:        LimitNone,
		CurrentCost:     m.accumulator.Get(rules[0].key),
		CostLimit:       rules[0].maxCost,
		CurrentRequests: m.requestAccumulator.Get(rules[0].key),
		RequestLimit:    rules[0].maxReq,
	}
}

// CheckRequestLimit checks only the request count limit for an API key.
// Returns whether the key is allowed, current count, and the limit.
func (m *Manager) CheckRequestLimit(apiKey string) (allowed bool, current int64, limit int64) {
	if m == nil {
		return true, 0, 0
	}
	if !m.IsEnabled() {
		return true, 0, 0
	}

	current = m.requestAccumulator.Get(apiKey)
	limit = m.GetRequestLimit(apiKey)

	if limit == 0 {
		return true, current, limit
	}
	return current < limit, current, limit
}

// CheckAndRecordRequest atomically checks the request limit for an API key and,
// when allowed, increments the request count by 1. It returns whether the
// request is allowed, the resulting request count, and the configured limit.
// When limits are disabled or limit is zero (unlimited), it still increments
// the counter for tracking purposes.
// For multi-tier quotas, increments ALL tiers atomically and blocks if ANY tier would exceed.
func (m *Manager) CheckAndRecordRequest(apiKey string) (allowed bool, current int64, limit int64) {
	if m == nil {
		return true, 0, 0
	}
	if !m.IsEnabled() {
		return true, 0, 0
	}

	rules := m.resolveRules(apiKey)
	if len(rules) == 0 {
		return true, 0, 0
	}

	// Single rule: use atomic accumulator method (no lock needed)
	if len(rules) == 1 {
		rule := rules[0]
		if rule.maxReq == 0 {
			// Unlimited - still increment for tracking
			m.requestAccumulator.Add(rule.key, 1)
			current = m.requestAccumulator.Get(rule.key)
			_ = m.saveRequests()
			return true, current, 0
		}
		ok, newCount := m.requestAccumulator.CheckAndAdd(rule.key, rule.maxReq)
		if ok {
			_ = m.saveRequests()
		}
		return ok, newCount, rule.maxReq
	}

	// Multi-rule: use per-key lock to ensure atomic check+increment across all tiers
	globalKeyLocks.lock(apiKey)
	defer globalKeyLocks.unlock(apiKey)

	// First pass: check all tiers
	for _, rule := range rules {
		if rule.maxReq > 0 {
			curr := m.requestAccumulator.Get(rule.key)
			if curr >= rule.maxReq {
				// Return the exceeded tier's values
				return false, curr, rule.maxReq
			}
		}
	}

	// Second pass: increment all tiers
	for _, rule := range rules {
		m.requestAccumulator.Add(rule.key, 1)
	}
	_ = m.saveRequests()

	// Return first tier's values for backward compatibility
	current = m.requestAccumulator.Get(rules[0].key)
	limit = rules[0].maxReq
	return true, current, limit
}

// RecordRequest increments the request count for an API key.
// Called by plugin after checking IsEnabled(), so no need to check here.
func (m *Manager) RecordRequest(apiKey string) {
	if m == nil {
		return
	}
	m.requestAccumulator.Add(apiKey, 1)
	m.saveRequests()
}

// GetCurrentRequestCount returns the current request count for an API key.
func (m *Manager) GetCurrentRequestCount(apiKey string) int64 {
	if m == nil {
		return 0
	}
	return m.requestAccumulator.Get(apiKey)
}

// TryReserveRequestSlot attempts to reserve a slot for a request in "count only success" mode.
// It checks if the combined count of persisted requests plus in-flight reservations is below the limit.
// For multi-tier quotas, reserves across ALL tiers atomically and blocks if ANY tier would exceed.
// Returns: allowed, current persisted count, limit.
func (m *Manager) TryReserveRequestSlot(apiKey string) (allowed bool, current int64, limit int64) {
	if m == nil {
		return true, 0, 0
	}
	if !m.IsEnabled() {
		return true, 0, 0
	}

	rules := m.resolveRules(apiKey)
	if len(rules) == 0 {
		return true, 0, 0
	}

	// For multi-tier, use per-key lock to ensure atomic reservation across all tiers
	if len(rules) > 1 {
		globalKeyLocks.lock(apiKey)
		defer globalKeyLocks.unlock(apiKey)
	}

	// First pass: check all tiers
	for _, rule := range rules {
		if rule.maxReq > 0 {
			ok, _ := m.requestAccumulator.TryReserve(rule.key, rule.maxReq)
			if !ok {
				// Release any reservations we made before failing
				for _, prevRule := range rules {
					if prevRule.key == rule.key {
						break
					}
					m.requestAccumulator.Complete(prevRule.key, false)
				}
				return false, m.requestAccumulator.Get(rule.key), rule.maxReq
			}
		} else {
			// Unlimited tier - still reserve for tracking
			m.requestAccumulator.TryReserve(rule.key, 0)
		}
	}

	// Return first tier's values for backward compatibility
	current = m.requestAccumulator.Get(rules[0].key)
	limit = rules[0].maxReq
	return true, current, limit
}

// CompleteRequestSlot finalizes a reserved request slot.
// If success is true (HTTP status < 400), the request count is incremented.
// Otherwise, the reservation is released without incrementing the count.
// For multi-tier quotas, completes ALL tier reservations.
func (m *Manager) CompleteRequestSlot(apiKey string, success bool) {
	if m == nil {
		return
	}

	rules := m.resolveRules(apiKey)
	if len(rules) == 0 {
		return
	}

	// Complete all tiers
	for _, rule := range rules {
		m.requestAccumulator.Complete(rule.key, success)
	}
	if success {
		_ = m.saveRequests()
	}
}

// RecordUsage calculates the cost for a usage record and accumulates it.
// The cost is calculated based on the model and token usage.
// Called by plugin after checking IsEnabled(), so no need to check here.
// For multi-tier quotas, adds cost to ALL tiers.
func (m *Manager) RecordUsage(apiKey, model string, tokens coreusage.Detail) {
	if m == nil {
		return
	}

	cost := m.calculator.CalculateCost(model, tokens.InputTokens, tokens.OutputTokens, tokens.CachedTokens)
	if cost > 0 {
		rules := m.resolveRules(apiKey)
		for _, rule := range rules {
			m.accumulator.Add(rule.key, cost)
		}
		m.save()
	}
}

// ResetKey resets the accumulated cost for an API key to zero.
// For multi-tier quotas, resets cost for all tiers.
func (m *Manager) ResetKey(apiKey string) error {
	if m == nil {
		return nil
	}
	rules := m.resolveRules(apiKey)
	for _, rule := range rules {
		m.accumulator.Reset(rule.key)
	}
	return m.save()
}

// ResetRequestCount resets the request count for an API key to zero.
// For multi-tier quotas, resets request count for all tiers.
func (m *Manager) ResetRequestCount(apiKey string) error {
	if m == nil {
		return nil
	}
	rules := m.resolveRules(apiKey)
	for _, rule := range rules {
		m.requestAccumulator.Reset(rule.key)
	}
	return m.saveRequests()
}

// ResetAll resets both cost and request count for an API key to zero.
// For multi-tier quotas, resets both for all tiers.
func (m *Manager) ResetAll(apiKey string) error {
	if m == nil {
		return nil
	}
	rules := m.resolveRules(apiKey)
	for _, rule := range rules {
		m.accumulator.Reset(rule.key)
		m.requestAccumulator.Reset(rule.key)
	}
	if err := m.save(); err != nil {
		return err
	}
	return m.saveRequests()
}

// ResetAllKeys resets both cost and request count for ALL keys to zero.
// Returns the number of keys that were reset.
func (m *Manager) ResetAllKeys() (int, error) {
	if m == nil {
		return 0, nil
	}
	// Get all keys from both accumulators
	allCosts := m.accumulator.GetAll()
	allRequests := m.requestAccumulator.GetAll()

	// Merge keys from both
	allKeys := make(map[string]struct{})
	for k := range allCosts {
		allKeys[k] = struct{}{}
	}
	for k := range allRequests {
		allKeys[k] = struct{}{}
	}

	// Reset each key
	for apiKey := range allKeys {
		m.accumulator.Reset(apiKey)
		m.requestAccumulator.Reset(apiKey)
	}

	// Save both
	if err := m.save(); err != nil {
		return len(allKeys), err
	}
	if err := m.saveRequests(); err != nil {
		return len(allKeys), err
	}
	return len(allKeys), nil
}

// GetCurrentCost returns the current accumulated cost for an API key.
func (m *Manager) GetCurrentCost(apiKey string) float64 {
	if m == nil {
		return 0
	}
	return m.accumulator.Get(apiKey)
}

// QuotaRuleInfo contains current status for a single quota tier.
type QuotaRuleInfo struct {
	ID                string  `json:"id"`
	MaxCost           float64 `json:"max_cost"`
	CurrentCost       float64 `json:"current_cost"`
	MaxRequests       int64   `json:"max_requests"`
	CurrentRequests   int64   `json:"current_requests"`
	AutoResetInterval string  `json:"auto_reset_interval"`
	NextResetTime     string  `json:"next_reset_time,omitempty"`
}

// KeyLimitInfo contains limit and cost information for an API key.
type KeyLimitInfo struct {
	APIKey            string  `json:"api_key"`
	MaxCost           float64 `json:"max_cost"`
	CurrentCost       float64 `json:"current_cost"`
	MaxRequests       int64   `json:"max_requests"`
	CurrentRequests   int64   `json:"current_requests"`
	AutoResetInterval string  `json:"auto_reset_interval"`
	// QuotaRules contains per-tier status for multi-tier quotas.
	// Empty for legacy single-tier keys.
	QuotaRules []QuotaRuleInfo `json:"quota_rules,omitempty"`
}

// GetAllLimits returns limit and cost information for all keys that have
// either a configured limit or accumulated cost/requests.
// Keys that only have accumulated data but are not in the access-keys list
// and don't have explicit limits configured are filtered out (orphaned keys).
// For multi-tier quota keys, QuotaRules contains per-tier current status.
func (m *Manager) GetAllLimits() []KeyLimitInfo {
	if m == nil {
		return nil
	}

	m.mu.RLock()
	defer m.mu.RUnlock()

	// Build a set of valid access keys from config
	validAccessKeys := make(map[string]struct{})
	for _, key := range m.cfg.APIKeys {
		validAccessKeys[key] = struct{}{}
	}

	keySet := make(map[string]struct{})
	result := []KeyLimitInfo{}

	for _, keyLimit := range m.cfg.AccessKeyLimits.Keys {
		keySet[keyLimit.APIKey] = struct{}{}

		info := KeyLimitInfo{
			APIKey:            keyLimit.APIKey,
			AutoResetInterval: keyLimit.AutoResetInterval,
		}

		// Check for multi-tier quotas
		if len(keyLimit.QuotaRules) > 0 {
			// Multi-tier mode: populate QuotaRules and aggregate totals from first tier for backward compatibility
			quotaRules := make([]QuotaRuleInfo, 0, len(keyLimit.QuotaRules))
			for _, rule := range keyLimit.QuotaRules {
				tk := tierKey(keyLimit.APIKey, rule.ID)
				ruleInfo := QuotaRuleInfo{
					ID:                rule.ID,
					MaxCost:           rule.MaxCost,
					CurrentCost:       m.accumulator.Get(tk),
					MaxRequests:       rule.MaxRequests,
					CurrentRequests:   m.requestAccumulator.Get(tk),
					AutoResetInterval: rule.AutoResetInterval,
				}
				// Calculate next reset time for this tier
				if rule.AutoResetInterval != "" && rule.AutoResetInterval != "none" {
					interval := ParseResetInterval(rule.AutoResetInterval)
					if interval != ResetNone && m.autoResetScheduler != nil {
						lastReset := m.autoResetScheduler.State().GetLastReset(tk)
						if !lastReset.IsZero() {
							nextReset := NextResetTime(lastReset, interval)
							ruleInfo.NextResetTime = nextReset.Format("2006-01-02T15:04:05Z07:00")
						}
					}
				}
				quotaRules = append(quotaRules, ruleInfo)
			}
			info.QuotaRules = quotaRules

			// For backward compatibility, aggregate totals from all tiers
			// Use the first tier with a non-zero value for MaxCost/MaxRequests
			var aggregatedCost, aggregatedRequests int64
			var maxCost float64
			var maxRequests int64
			for _, rule := range quotaRules {
				aggregatedCost += int64(rule.CurrentCost * 100) // cents for precision
				aggregatedRequests += rule.CurrentRequests
				if maxCost == 0 && rule.MaxCost > 0 {
					maxCost = rule.MaxCost
				}
				if maxRequests == 0 && rule.MaxRequests > 0 {
					maxRequests = rule.MaxRequests
				}
			}
			info.MaxCost = maxCost
			info.CurrentCost = float64(aggregatedCost) / 100.0
			info.MaxRequests = maxRequests
			info.CurrentRequests = aggregatedRequests
		} else {
			// Legacy single-tier mode
			info.MaxCost = keyLimit.MaxCost
			info.CurrentCost = m.accumulator.Get(keyLimit.APIKey)
			info.MaxRequests = keyLimit.MaxRequests
			info.CurrentRequests = m.requestAccumulator.Get(keyLimit.APIKey)
		}

		result = append(result, info)
	}

	allCosts := m.accumulator.GetAll()
	allRequests := m.requestAccumulator.GetAll()

	// Merge keys from both accumulators
	allKeys := make(map[string]struct{})
	for k := range allCosts {
		allKeys[k] = struct{}{}
	}
	for k := range allRequests {
		allKeys[k] = struct{}{}
	}

	for apiKey := range allKeys {
		if _, exists := keySet[apiKey]; !exists {
			// Only include if the key exists in the valid access keys list
			if _, valid := validAccessKeys[apiKey]; valid {
				result = append(result, KeyLimitInfo{
					APIKey:            apiKey,
					MaxCost:           m.cfg.AccessKeyLimits.DefaultMaxCost,
					CurrentCost:       allCosts[apiKey],
					MaxRequests:       m.cfg.AccessKeyLimits.DefaultMaxRequests,
					CurrentRequests:   allRequests[apiKey],
					AutoResetInterval: "",
				})
			}
		}
	}

	return result
}

// GetDefaultMaxCost returns the default maximum cost for keys without specific limits.
func (m *Manager) GetDefaultMaxCost() float64 {
	if m == nil || m.cfg == nil {
		return 0
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.cfg.AccessKeyLimits.DefaultMaxCost
}

// GetDefaultMaxRequests returns the default maximum request count for keys without specific limits.
func (m *Manager) GetDefaultMaxRequests() int64 {
	if m == nil || m.cfg == nil {
		return 0
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.cfg.AccessKeyLimits.DefaultMaxRequests
}

// Calculator returns the underlying pricing calculator.
func (m *Manager) Calculator() *Calculator {
	if m == nil {
		return nil
	}
	return m.calculator
}

// save persists the cost accumulator to disk.
func (m *Manager) save() error {
	if m.dataDir == "" {
		return nil
	}
	return m.accumulator.SaveToFile(filepath.Join(m.dataDir, accumulatorFileName))
}

// saveRequests persists the request accumulator to disk.
func (m *Manager) saveRequests() error {
	if m.dataDir == "" {
		return nil
	}
	return m.requestAccumulator.SaveToFile(filepath.Join(m.dataDir, requestAccumulatorFileName))
}

// StartAutoReset starts the background auto-reset scheduler.
// It periodically checks all keys and resets counters that have exceeded their interval.
func (m *Manager) StartAutoReset() {
	if m == nil || m.autoResetScheduler == nil {
		return
	}

	m.autoResetScheduler.SetCheckFunction(func() {
		m.checkAndPerformAutoResets()
	})
	m.autoResetScheduler.Start()
}

// StopAutoReset stops the background auto-reset scheduler.
func (m *Manager) StopAutoReset() {
	if m == nil || m.autoResetScheduler == nil {
		return
	}
	m.autoResetScheduler.Stop()
}

// checkAndPerformAutoResets checks all configured keys and resets counters as needed.
// For multi-tier quotas, each tier resets independently based on its own interval.
func (m *Manager) checkAndPerformAutoResets() {
	if m == nil || m.cfg == nil || !m.IsEnabled() {
		return
	}

	m.mu.RLock()
	keys := make([]config.AccessKeyLimit, len(m.cfg.AccessKeyLimits.Keys))
	copy(keys, m.cfg.AccessKeyLimits.Keys)
	m.mu.RUnlock()

	now := time.Now()
	state := m.autoResetScheduler.State()

	for _, keyLimit := range keys {
		// Check if this key uses multi-tier quotas
		if len(keyLimit.QuotaRules) > 0 {
			// Multi-tier mode: each tier resets independently
			for _, rule := range keyLimit.QuotaRules {
				interval := ParseResetInterval(rule.AutoResetInterval)
				if interval == ResetNone {
					continue
				}

				tierStateKey := tierKey(keyLimit.APIKey, rule.ID)
				lastReset := state.GetLastReset(tierStateKey)
				if lastReset.IsZero() {
					state.SetLastReset(tierStateKey, now)
					continue
				}

				if ShouldReset(lastReset, interval, now) {
					m.resetTier(keyLimit.APIKey, rule.ID)
					state.SetLastReset(tierStateKey, now)
				}
			}
		} else {
			// Legacy single-tier mode
			interval := ParseResetInterval(keyLimit.AutoResetInterval)
			if interval == ResetNone {
				continue
			}

			lastReset := state.GetLastReset(keyLimit.APIKey)
			if lastReset.IsZero() {
				state.SetLastReset(keyLimit.APIKey, now)
				continue
			}

			if ShouldReset(lastReset, interval, now) {
				_ = m.ResetAll(keyLimit.APIKey)
				state.SetLastReset(keyLimit.APIKey, now)
			}
		}
	}

	_ = m.autoResetScheduler.SaveState()
}

// resetTier resets counters for a specific tier of an API key.
func (m *Manager) resetTier(apiKey, ruleID string) {
	key := tierKey(apiKey, ruleID)
	m.accumulator.Reset(key)
	m.requestAccumulator.Reset(key)
	_ = m.save()
	_ = m.saveRequests()
}

// GetAutoResetInterval returns the auto-reset interval for an API key.
func (m *Manager) GetAutoResetInterval(apiKey string) string {
	if m == nil || m.cfg == nil {
		return ""
	}
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, keyLimit := range m.cfg.AccessKeyLimits.Keys {
		if keyLimit.APIKey == apiKey {
			return keyLimit.AutoResetInterval
		}
	}
	return ""
}

// SetAutoResetInterval updates the auto-reset interval for a specific API key.
func (m *Manager) SetAutoResetInterval(apiKey string, interval string) {
	if m == nil || m.cfg == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()

	for i, keyLimit := range m.cfg.AccessKeyLimits.Keys {
		if keyLimit.APIKey == apiKey {
			m.cfg.AccessKeyLimits.Keys[i].AutoResetInterval = interval
			if ParseResetInterval(interval) != ResetNone {
				m.autoResetScheduler.State().SetLastReset(apiKey, time.Now())
			}
			return
		}
	}
	m.cfg.AccessKeyLimits.Keys = append(m.cfg.AccessKeyLimits.Keys, config.AccessKeyLimit{
		APIKey:            apiKey,
		AutoResetInterval: interval,
	})
	if ParseResetInterval(interval) != ResetNone {
		m.autoResetScheduler.State().SetLastReset(apiKey, time.Now())
	}
}

// GetLastResetTime returns the last reset time for an API key.
func (m *Manager) GetLastResetTime(apiKey string) time.Time {
	if m == nil || m.autoResetScheduler == nil {
		return time.Time{}
	}
	return m.autoResetScheduler.State().GetLastReset(apiKey)
}

// GetNextResetTime returns the next scheduled reset time for an API key.
// Returns zero time if no auto-reset is configured.
func (m *Manager) GetNextResetTime(apiKey string) time.Time {
	if m == nil {
		return time.Time{}
	}
	interval := ParseResetInterval(m.GetAutoResetInterval(apiKey))
	if interval == ResetNone {
		return time.Time{}
	}
	lastReset := m.GetLastResetTime(apiKey)
	if lastReset.IsZero() {
		return time.Time{}
	}
	return NextResetTime(lastReset, interval)
}
