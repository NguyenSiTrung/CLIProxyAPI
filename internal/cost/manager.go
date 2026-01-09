// Package cost provides cost calculation and tracking for API requests.
package cost

import (
	"path/filepath"
	"sync"

	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
	coreusage "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/usage"
)

const accumulatorFileName = "cost_accumulator.json"

// Manager combines config, calculator, and accumulator to provide
// a unified interface for cost limit management.
type Manager struct {
	mu          sync.RWMutex
	cfg         *config.Config
	calculator  *Calculator
	accumulator *Accumulator
	dataDir     string
}

// NewManager creates a new cost limit manager.
// It loads existing accumulated costs from the data directory if available.
func NewManager(cfg *config.Config, dataDir string) *Manager {
	m := &Manager{
		cfg:         cfg,
		calculator:  NewCalculator(),
		accumulator: NewAccumulator(),
		dataDir:     dataDir,
	}
	if dataDir != "" {
		_ = m.accumulator.LoadFromFile(filepath.Join(dataDir, accumulatorFileName))
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

// CheckLimit checks if an API key is within its cost limit.
// Returns whether the key is allowed to make requests, the current accumulated cost,
// and the configured limit.
func (m *Manager) CheckLimit(apiKey string) (allowed bool, current float64, limit float64) {
	if m == nil {
		return true, 0, 0
	}
	if !m.IsEnabled() {
		return true, 0, 0
	}

	current = m.accumulator.Get(apiKey)
	limit = m.GetLimit(apiKey)

	if limit == 0 {
		return true, current, limit
	}
	return current < limit, current, limit
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

// GetCurrentCost returns the current accumulated cost for an API key.
func (m *Manager) GetCurrentCost(apiKey string) float64 {
	if m == nil {
		return 0
	}
	return m.accumulator.Get(apiKey)
}

// KeyLimitInfo contains limit and cost information for an API key.
type KeyLimitInfo struct {
	APIKey      string  `json:"api_key"`
	MaxCost     float64 `json:"max_cost"`
	CurrentCost float64 `json:"current_cost"`
}

// GetAllLimits returns limit and cost information for all keys that have
// either a configured limit or accumulated cost.
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
			APIKey:      keyLimit.APIKey,
			MaxCost:     keyLimit.MaxCost,
			CurrentCost: m.accumulator.Get(keyLimit.APIKey),
		})
	}

	allCosts := m.accumulator.GetAll()
	for apiKey, cost := range allCosts {
		if _, exists := keySet[apiKey]; !exists {
			result = append(result, KeyLimitInfo{
				APIKey:      apiKey,
				MaxCost:     m.cfg.AccessKeyLimits.DefaultMaxCost,
				CurrentCost: cost,
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

// Calculator returns the underlying pricing calculator.
func (m *Manager) Calculator() *Calculator {
	if m == nil {
		return nil
	}
	return m.calculator
}

// save persists the accumulator to disk.
func (m *Manager) save() error {
	if m.dataDir == "" {
		return nil
	}
	return m.accumulator.SaveToFile(filepath.Join(m.dataDir, accumulatorFileName))
}
