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

// LimitExceededType indicates which limit type was exceeded.
type LimitExceededType string

const (
	LimitNone    LimitExceededType = "none"
	LimitCost    LimitExceededType = "cost"
	LimitRequest LimitExceededType = "request"
)

// CheckLimit checks if an API key is within both cost and request limits.
// Returns whether the key is allowed to make requests, the current accumulated cost,
// the configured cost limit, and which limit type was exceeded (if any).
func (m *Manager) CheckLimit(apiKey string) (allowed bool, currentCost float64, costLimit float64, exceeded LimitExceededType) {
	if m == nil {
		return true, 0, 0, LimitNone
	}
	if !m.IsEnabled() {
		return true, 0, 0, LimitNone
	}

	currentCost = m.accumulator.Get(apiKey)
	costLimit = m.GetLimit(apiKey)
	currentRequests := m.requestAccumulator.Get(apiKey)
	requestLimit := m.GetRequestLimit(apiKey)

	// Check cost limit first
	if costLimit > 0 && currentCost >= costLimit {
		return false, currentCost, costLimit, LimitCost
	}

	// Check request limit
	if requestLimit > 0 && currentRequests >= requestLimit {
		return false, currentCost, costLimit, LimitRequest
	}

	return true, currentCost, costLimit, LimitNone
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

// RecordRequest increments the request count for an API key.
func (m *Manager) RecordRequest(apiKey string) {
	if m == nil || !m.IsEnabled() {
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

// RecordUsage calculates the cost for a usage record and accumulates it.
// The cost is calculated based on the model and token usage.
func (m *Manager) RecordUsage(apiKey, model string, tokens coreusage.Detail) {
	if m == nil || !m.IsEnabled() {
		return
	}

	cost := m.calculator.CalculateCost(model, tokens.InputTokens, tokens.OutputTokens, tokens.CachedTokens)
	if cost > 0 {
		m.accumulator.Add(apiKey, cost)
		m.save()
	}
}

// ResetKey resets the accumulated cost for an API key to zero.
func (m *Manager) ResetKey(apiKey string) error {
	if m == nil {
		return nil
	}
	m.accumulator.Reset(apiKey)
	return m.save()
}

// ResetRequestCount resets the request count for an API key to zero.
func (m *Manager) ResetRequestCount(apiKey string) error {
	if m == nil {
		return nil
	}
	m.requestAccumulator.Reset(apiKey)
	return m.saveRequests()
}

// ResetAll resets both cost and request count for an API key to zero.
func (m *Manager) ResetAll(apiKey string) error {
	if m == nil {
		return nil
	}
	m.accumulator.Reset(apiKey)
	m.requestAccumulator.Reset(apiKey)
	if err := m.save(); err != nil {
		return err
	}
	return m.saveRequests()
}

// GetCurrentCost returns the current accumulated cost for an API key.
func (m *Manager) GetCurrentCost(apiKey string) float64 {
	if m == nil {
		return 0
	}
	return m.accumulator.Get(apiKey)
}

// KeyLimitInfo contains limit and cost information for an API key.
type KeyLimitInfo struct {
	APIKey            string  `json:"api_key"`
	MaxCost           float64 `json:"max_cost"`
	CurrentCost       float64 `json:"current_cost"`
	MaxRequests       int64   `json:"max_requests"`
	CurrentRequests   int64   `json:"current_requests"`
	AutoResetInterval string  `json:"auto_reset_interval"`
}

// GetAllLimits returns limit and cost information for all keys that have
// either a configured limit or accumulated cost/requests.
func (m *Manager) GetAllLimits() []KeyLimitInfo {
	if m == nil {
		return nil
	}

	m.mu.RLock()
	defer m.mu.RUnlock()

	keySet := make(map[string]struct{})
	result := []KeyLimitInfo{}

	for _, keyLimit := range m.cfg.AccessKeyLimits.Keys {
		keySet[keyLimit.APIKey] = struct{}{}
		result = append(result, KeyLimitInfo{
			APIKey:            keyLimit.APIKey,
			MaxCost:           keyLimit.MaxCost,
			CurrentCost:       m.accumulator.Get(keyLimit.APIKey),
			MaxRequests:       keyLimit.MaxRequests,
			CurrentRequests:   m.requestAccumulator.Get(keyLimit.APIKey),
			AutoResetInterval: keyLimit.AutoResetInterval,
		})
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

	_ = m.autoResetScheduler.SaveState()
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
