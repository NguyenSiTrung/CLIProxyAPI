// Package cost provides cost calculation and tracking for API requests.
package cost

import (
	"sync"

	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
)

// TierKeyDelimiter separates API key from tier ID in composite keys.
const TierKeyDelimiter = "#"

// resolvedRule represents a resolved quota rule ready for enforcement.
type resolvedRule struct {
	id       string        // tier ID (empty for legacy single-tier)
	key      string        // composite key for accumulators (e.g., "apiKey#daily")
	maxCost  float64       // max cost limit (0 = unlimited)
	maxReq   int64         // max request limit (0 = unlimited)
	interval ResetInterval // reset interval
}

// tierKey builds the composite key for accumulators.
// For legacy (ruleID=""), returns just the apiKey.
// For multi-tier, returns "apiKey#ruleID".
func tierKey(apiKey, ruleID string) string {
	if ruleID == "" {
		return apiKey
	}
	return apiKey + TierKeyDelimiter + ruleID
}

// resolveRules returns the quota rules that apply to an API key.
// If QuotaRules is configured, those are used (multi-tier mode).
// Otherwise, falls back to legacy single-tier using MaxCost/MaxRequests/AutoResetInterval.
// If no per-key config exists, uses defaults (no reset interval).
func (m *Manager) resolveRules(apiKey string) []resolvedRule {
	m.mu.RLock()
	defer m.mu.RUnlock()

	// Find per-key config
	var keyLimit *config.AccessKeyLimit
	for i := range m.cfg.AccessKeyLimits.Keys {
		if m.cfg.AccessKeyLimits.Keys[i].APIKey == apiKey {
			keyLimit = &m.cfg.AccessKeyLimits.Keys[i]
			break
		}
	}

	// Multi-tier mode: use QuotaRules if defined
	if keyLimit != nil && len(keyLimit.QuotaRules) > 0 {
		rules := make([]resolvedRule, 0, len(keyLimit.QuotaRules))
		for _, qr := range keyLimit.QuotaRules {
			rules = append(rules, resolvedRule{
				id:       qr.ID,
				key:      tierKey(apiKey, qr.ID),
				maxCost:  qr.MaxCost,
				maxReq:   qr.MaxRequests,
				interval: ParseResetInterval(qr.AutoResetInterval),
			})
		}
		return rules
	}

	// Legacy single-tier mode
	if keyLimit != nil {
		return []resolvedRule{{
			id:       "",
			key:      apiKey,
			maxCost:  keyLimit.MaxCost,
			maxReq:   keyLimit.MaxRequests,
			interval: ParseResetInterval(keyLimit.AutoResetInterval),
		}}
	}

	// No per-key config: use defaults (no reset)
	return []resolvedRule{{
		id:       "",
		key:      apiKey,
		maxCost:  m.cfg.AccessKeyLimits.DefaultMaxCost,
		maxReq:   m.cfg.AccessKeyLimits.DefaultMaxRequests,
		interval: ResetNone,
	}}
}

// hasMultiTierQuotas returns true if the API key has multi-tier quotas configured.
func (m *Manager) hasMultiTierQuotas(apiKey string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for i := range m.cfg.AccessKeyLimits.Keys {
		if m.cfg.AccessKeyLimits.Keys[i].APIKey == apiKey {
			return len(m.cfg.AccessKeyLimits.Keys[i].QuotaRules) > 0
		}
	}
	return false
}

// keyLocks provides per-API-key locks for atomic multi-tier operations.
type keyLocks struct {
	mu    sync.Mutex
	locks map[string]*sync.Mutex
}

var globalKeyLocks = &keyLocks{
	locks: make(map[string]*sync.Mutex),
}

// lock acquires a lock for the given API key.
func (kl *keyLocks) lock(apiKey string) {
	kl.mu.Lock()
	l, ok := kl.locks[apiKey]
	if !ok {
		l = &sync.Mutex{}
		kl.locks[apiKey] = l
	}
	kl.mu.Unlock()
	l.Lock()
}

// unlock releases the lock for the given API key.
func (kl *keyLocks) unlock(apiKey string) {
	kl.mu.Lock()
	l, ok := kl.locks[apiKey]
	kl.mu.Unlock()
	if ok {
		l.Unlock()
	}
}
