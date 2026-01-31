package management

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/cost"
)

// costManager holds a reference to the cost manager for access key limits.
var costManager *cost.Manager

// SetCostManager sets the cost manager reference used by cost limit endpoints.
func (h *Handler) SetCostManager(manager *cost.Manager) {
	costManager = manager
}

// GetAccessKeyLimits returns the current access key cost limits configuration.
// GET /v0/management/access-key-limits
func (h *Handler) GetAccessKeyLimits(c *gin.Context) {
	if costManager == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "cost manager not initialized"})
		return
	}

	type quotaRuleInfo struct {
		ID                string  `json:"id"`
		MaxCost           float64 `json:"max_cost"`
		CurrentCost       float64 `json:"current_cost"`
		MaxRequests       int64   `json:"max_requests"`
		CurrentRequests   int64   `json:"current_requests"`
		AutoResetInterval string  `json:"auto_reset_interval,omitempty"`
		NextResetTime     string  `json:"next_reset_time,omitempty"`
	}

	type rateLimitInfo struct {
		MinInterval  string `json:"min_interval,omitempty"`
		MaxQueueSize int    `json:"max_queue_size,omitempty"`
		QueueTimeout string `json:"queue_timeout,omitempty"`
	}

	type keyInfo struct {
		APIKey            string          `json:"api_key"`
		MaxCost           float64         `json:"max_cost"`
		CurrentCost       float64         `json:"current_cost"`
		MaxRequests       int64           `json:"max_requests"`
		CurrentRequests   int64           `json:"current_requests"`
		AutoResetInterval string          `json:"auto_reset_interval,omitempty"`
		NextResetTime     string          `json:"next_reset_time,omitempty"`
		ExpiresAt         string          `json:"expires_at,omitempty"`
		QuotaRules        []quotaRuleInfo `json:"quota_rules,omitempty"`
		RateLimit         *rateLimitInfo  `json:"rate_limit,omitempty"`
	}

	// Build maps of ExpiresAt and RateLimit from config for lookup
	expiresAtMap := make(map[string]*time.Time)
	rateLimitMap := make(map[string]*config.RateLimitKeyConfig)
	for _, keyLimit := range h.cfg.AccessKeyLimits.Keys {
		if keyLimit.ExpiresAt != nil {
			expiresAtMap[keyLimit.APIKey] = keyLimit.ExpiresAt
		}
		if keyLimit.RateLimit != nil {
			rateLimitMap[keyLimit.APIKey] = keyLimit.RateLimit
		}
	}

	keys := costManager.GetAllLimits()
	keyInfos := make([]keyInfo, len(keys))
	for i, k := range keys {
		info := keyInfo{
			APIKey:            k.APIKey,
			MaxCost:           k.MaxCost,
			CurrentCost:       k.CurrentCost,
			MaxRequests:       k.MaxRequests,
			CurrentRequests:   k.CurrentRequests,
			AutoResetInterval: k.AutoResetInterval,
		}

		// Include expires_at if set
		if expiresAt, ok := expiresAtMap[k.APIKey]; ok && expiresAt != nil {
			info.ExpiresAt = expiresAt.Format(time.RFC3339)
		}

		// For legacy single-tier keys, compute next reset time
		if len(k.QuotaRules) == 0 && k.AutoResetInterval != "" && k.AutoResetInterval != "none" {
			nextReset := costManager.GetNextResetTime(k.APIKey)
			if !nextReset.IsZero() {
				info.NextResetTime = nextReset.Format("2006-01-02T15:04:05Z07:00")
			}
		}

		// For multi-tier keys, include quota rules with their next reset times
		if len(k.QuotaRules) > 0 {
			info.QuotaRules = make([]quotaRuleInfo, len(k.QuotaRules))
			for j, rule := range k.QuotaRules {
				info.QuotaRules[j] = quotaRuleInfo{
					ID:                rule.ID,
					MaxCost:           rule.MaxCost,
					CurrentCost:       rule.CurrentCost,
					MaxRequests:       rule.MaxRequests,
					CurrentRequests:   rule.CurrentRequests,
					AutoResetInterval: rule.AutoResetInterval,
					NextResetTime:     rule.NextResetTime,
				}
			}
		}

		// Include rate limit overrides if set
		if rl, ok := rateLimitMap[k.APIKey]; ok && rl != nil {
			info.RateLimit = &rateLimitInfo{
				MinInterval:  rl.MinInterval,
				MaxQueueSize: rl.MaxQueueSize,
				QueueTimeout: rl.QueueTimeout,
			}
		}

		keyInfos[i] = info
	}

	c.JSON(http.StatusOK, gin.H{
		"enabled":                     costManager.IsEnabled(),
		"default_max_cost":            costManager.GetDefaultMaxCost(),
		"default_max_requests":        costManager.GetDefaultMaxRequests(),
		"count_only_success_requests": costManager.CountOnlySuccessRequests(),
		"keys":                        keyInfos,
	})
}

// PutAccessKeyLimitsEnabled enables or disables the access key cost limits feature.
// PUT /v0/management/access-key-limits/enabled
func (h *Handler) PutAccessKeyLimitsEnabled(c *gin.Context) {
	if costManager == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "cost manager not initialized"})
		return
	}

	var body struct {
		Enabled *bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Enabled == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body: expected {\"enabled\": bool}"})
		return
	}

	// Lock to ensure thread-safe modification of config and atomic persist
	h.mu.Lock()
	h.cfg.AccessKeyLimits.Enabled = *body.Enabled
	h.mu.Unlock()
	h.persist(c)
}

// PutAccessKeyLimitsCountOnlySuccess updates whether only successful requests are counted.
// PUT /v0/management/access-key-limits/count-only-success-requests
func (h *Handler) PutAccessKeyLimitsCountOnlySuccess(c *gin.Context) {
	if costManager == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "cost manager not initialized"})
		return
	}

	var body struct {
		CountOnlySuccessRequests *bool `json:"count_only_success_requests"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.CountOnlySuccessRequests == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body: expected {\"count_only_success_requests\": bool}"})
		return
	}

	// Lock to ensure thread-safe modification of config and atomic persist
	h.mu.Lock()
	h.cfg.AccessKeyLimits.CountOnlySuccessRequests = *body.CountOnlySuccessRequests
	h.mu.Unlock()
	h.persist(c)
}

// QuotaRuleInput is the input format for quota rules in PUT requests
type QuotaRuleInput struct {
	ID                string  `json:"id"`
	MaxCost           float64 `json:"max_cost"`
	MaxRequests       int64   `json:"max_requests"`
	AutoResetInterval string  `json:"auto_reset_interval"`
}

// PutAccessKeyLimit updates the cost/request limit for a specific API key.
// Supports both single-tier (legacy) and multi-tier (quota_rules) modes.
// PUT /v0/management/access-key-limits/keys/:key
func (h *Handler) PutAccessKeyLimit(c *gin.Context) {
	if costManager == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "cost manager not initialized"})
		return
	}

	apiKey := c.Param("key")
	if apiKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "api key is required"})
		return
	}

	type rateLimitInput struct {
		MinInterval  *string `json:"min_interval"`
		MaxQueueSize *int    `json:"max_queue_size"`
		QueueTimeout *string `json:"queue_timeout"`
	}

	var body struct {
		MaxCost           *float64          `json:"max_cost"`
		MaxRequests       *int64            `json:"max_requests"`
		AutoResetInterval *string           `json:"auto_reset_interval"`
		QuotaRules        *[]QuotaRuleInput `json:"quota_rules"`
		ExpiresAt         *string           `json:"expires_at"`
		RateLimit         *rateLimitInput   `json:"rate_limit"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON body"})
		return
	}

	// Parse expires_at if provided (empty string clears expiration)
	expiresAtProvided := body.ExpiresAt != nil
	var expiresAt *time.Time
	if expiresAtProvided && strings.TrimSpace(*body.ExpiresAt) != "" {
		t, err := time.Parse(time.RFC3339, strings.TrimSpace(*body.ExpiresAt))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid expires_at format: expected RFC3339 timestamp"})
			return
		}
		expiresAt = &t
	}

	// Check if this is a multi-tier update (quota_rules is present)
	if body.QuotaRules != nil {
		rules := *body.QuotaRules

		// If quota_rules is empty AND legacy fields are provided, switch to legacy mode
		if len(rules) == 0 && (body.MaxCost != nil || body.MaxRequests != nil || body.AutoResetInterval != nil) {
			// Clear quota_rules and apply legacy fields
			h.mu.Lock()
			h.updateAccessKeyQuotaRulesLocked(apiKey, nil) // Clear multi-tier rules
			h.updateAccessKeyLimitLocked(apiKey, body.MaxCost, body.MaxRequests, body.AutoResetInterval)
			if expiresAtProvided {
				h.updateAccessKeyExpiresAtLocked(apiKey, expiresAt)
			}
			if body.RateLimit != nil {
				h.updateAccessKeyRateLimitLocked(apiKey, body.RateLimit.MinInterval, body.RateLimit.MaxQueueSize, body.RateLimit.QueueTimeout)
			}
			h.mu.Unlock()
			h.persist(c)
			return
		}

		// Multi-tier mode: validate and apply quota rules
		if err := validateQuotaRules(rules); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		// Convert to config.QuotaRule format (trim IDs for consistency)
		configRules := make([]config.QuotaRule, len(rules))
		for i, r := range rules {
			configRules[i] = config.QuotaRule{
				ID:                strings.TrimSpace(r.ID),
				MaxCost:           r.MaxCost,
				MaxRequests:       r.MaxRequests,
				AutoResetInterval: r.AutoResetInterval,
			}
		}

		// Lock and update
		h.mu.Lock()
		h.updateAccessKeyQuotaRulesLocked(apiKey, configRules)
		if expiresAtProvided {
			h.updateAccessKeyExpiresAtLocked(apiKey, expiresAt)
		}
		if body.RateLimit != nil {
			h.updateAccessKeyRateLimitLocked(apiKey, body.RateLimit.MinInterval, body.RateLimit.MaxQueueSize, body.RateLimit.QueueTimeout)
		}
		h.mu.Unlock()
		h.persist(c)
		return
	}

	// Legacy single-tier mode
	rateLimitProvided := body.RateLimit != nil
	if body.MaxCost == nil && body.MaxRequests == nil && body.AutoResetInterval == nil && !expiresAtProvided && !rateLimitProvided {
		c.JSON(http.StatusBadRequest, gin.H{"error": "at least one of max_cost, max_requests, auto_reset_interval, quota_rules, expires_at, or rate_limit is required"})
		return
	}

	// Validate non-negative values
	if body.MaxCost != nil && *body.MaxCost < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "max_cost cannot be negative"})
		return
	}
	if body.MaxRequests != nil && *body.MaxRequests < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "max_requests cannot be negative"})
		return
	}

	// Lock to ensure thread-safe modification of config and atomic persist
	h.mu.Lock()
	h.updateAccessKeyLimitLocked(apiKey, body.MaxCost, body.MaxRequests, body.AutoResetInterval)
	if expiresAtProvided {
		h.updateAccessKeyExpiresAtLocked(apiKey, expiresAt)
	}
	if rateLimitProvided {
		h.updateAccessKeyRateLimitLocked(apiKey, body.RateLimit.MinInterval, body.RateLimit.MaxQueueSize, body.RateLimit.QueueTimeout)
	}
	h.mu.Unlock()
	h.persist(c)
}

// validateQuotaRules validates the input quota rules
func validateQuotaRules(rules []QuotaRuleInput) error {
	if len(rules) == 0 {
		return nil // Empty rules = switch to legacy mode (clear quota_rules)
	}

	seenIDs := make(map[string]bool)
	for i, rule := range rules {
		// ID is required and must be unique
		id := strings.TrimSpace(rule.ID)
		if id == "" {
			return fmt.Errorf("quota rule %d: id is required", i+1)
		}
		// Reject IDs containing the tier key delimiter (#) to avoid accumulator key collisions
		if strings.Contains(id, "#") {
			return fmt.Errorf("quota rule '%s': id cannot contain '#' character", id)
		}
		if seenIDs[id] {
			return fmt.Errorf("quota rule %d: duplicate id '%s'", i+1, id)
		}
		seenIDs[id] = true

		// Non-negative values
		if rule.MaxCost < 0 {
			return fmt.Errorf("quota rule '%s': max_cost cannot be negative", id)
		}
		if rule.MaxRequests < 0 {
			return fmt.Errorf("quota rule '%s': max_requests cannot be negative", id)
		}

		// At least one limit should be set
		if rule.MaxCost == 0 && rule.MaxRequests == 0 {
			return fmt.Errorf("quota rule '%s': at least one of max_cost or max_requests must be set", id)
		}
	}
	return nil
}

// updateAccessKeyQuotaRulesLocked updates the quota rules for an API key.
// This replaces all existing rules with the new set.
// IMPORTANT: Caller must hold h.mu lock.
func (h *Handler) updateAccessKeyQuotaRulesLocked(apiKey string, rules []config.QuotaRule) {
	// Find existing key entry
	for i, keyLimit := range h.cfg.AccessKeyLimits.Keys {
		if keyLimit.APIKey == apiKey {
			// Update existing entry: replace quota rules
			h.cfg.AccessKeyLimits.Keys[i].QuotaRules = rules
			// When switching to multi-tier, clear legacy fields to avoid confusion
			if len(rules) > 0 {
				h.cfg.AccessKeyLimits.Keys[i].MaxCost = 0
				h.cfg.AccessKeyLimits.Keys[i].MaxRequests = 0
				h.cfg.AccessKeyLimits.Keys[i].AutoResetInterval = ""
			}
			return
		}
	}

	// Key not found, create new entry
	newEntry := config.AccessKeyLimit{
		APIKey:     apiKey,
		QuotaRules: rules,
	}
	h.cfg.AccessKeyLimits.Keys = append(h.cfg.AccessKeyLimits.Keys, newEntry)
}

// updateAccessKeyLimitLocked updates the limit configuration in h.cfg for a specific API key.
// It finds or creates the key entry and applies the provided limit changes.
// IMPORTANT: Caller must hold h.mu lock.
func (h *Handler) updateAccessKeyLimitLocked(apiKey string, maxCost *float64, maxRequests *int64, autoResetInterval *string) {
	// Find existing key entry
	for i, keyLimit := range h.cfg.AccessKeyLimits.Keys {
		if keyLimit.APIKey == apiKey {
			// Update existing entry
			if maxCost != nil {
				h.cfg.AccessKeyLimits.Keys[i].MaxCost = *maxCost
			}
			if maxRequests != nil {
				h.cfg.AccessKeyLimits.Keys[i].MaxRequests = *maxRequests
			}
			if autoResetInterval != nil {
				h.cfg.AccessKeyLimits.Keys[i].AutoResetInterval = *autoResetInterval
			}
			return
		}
	}

	// Key not found, create new entry
	newEntry := config.AccessKeyLimit{APIKey: apiKey}
	if maxCost != nil {
		newEntry.MaxCost = *maxCost
	}
	if maxRequests != nil {
		newEntry.MaxRequests = *maxRequests
	}
	if autoResetInterval != nil {
		newEntry.AutoResetInterval = *autoResetInterval
	}
	h.cfg.AccessKeyLimits.Keys = append(h.cfg.AccessKeyLimits.Keys, newEntry)
}

// updateAccessKeyExpiresAtLocked updates the expiration time for a specific API key.
// If expiresAt is nil, the expiration is cleared. If the key doesn't exist, it creates a new entry.
// IMPORTANT: Caller must hold h.mu lock.
func (h *Handler) updateAccessKeyExpiresAtLocked(apiKey string, expiresAt *time.Time) {
	// Find existing key entry
	for i, keyLimit := range h.cfg.AccessKeyLimits.Keys {
		if keyLimit.APIKey == apiKey {
			h.cfg.AccessKeyLimits.Keys[i].ExpiresAt = expiresAt
			return
		}
	}

	// Key not found, only create new entry if expiresAt is set
	if expiresAt != nil {
		newEntry := config.AccessKeyLimit{
			APIKey:    apiKey,
			ExpiresAt: expiresAt,
		}
		h.cfg.AccessKeyLimits.Keys = append(h.cfg.AccessKeyLimits.Keys, newEntry)
	}
}

// updateAccessKeyRateLimitLocked updates the rate limit overrides for a specific API key.
// If all values are nil/empty/zero, the rate limit config is cleared.
// IMPORTANT: Caller must hold h.mu lock.
func (h *Handler) updateAccessKeyRateLimitLocked(apiKey string, minInterval *string, maxQueueSize *int, queueTimeout *string) {
	// Determine if we should clear or set rate limit
	shouldClear := true
	if minInterval != nil && *minInterval != "" {
		shouldClear = false
	}
	if maxQueueSize != nil && *maxQueueSize > 0 {
		shouldClear = false
	}
	if queueTimeout != nil && *queueTimeout != "" {
		shouldClear = false
	}

	// Find existing key entry
	for i, keyLimit := range h.cfg.AccessKeyLimits.Keys {
		if keyLimit.APIKey == apiKey {
			if shouldClear {
				h.cfg.AccessKeyLimits.Keys[i].RateLimit = nil
			} else {
				if h.cfg.AccessKeyLimits.Keys[i].RateLimit == nil {
					h.cfg.AccessKeyLimits.Keys[i].RateLimit = &config.RateLimitKeyConfig{}
				}
				if minInterval != nil {
					h.cfg.AccessKeyLimits.Keys[i].RateLimit.MinInterval = *minInterval
				}
				if maxQueueSize != nil {
					h.cfg.AccessKeyLimits.Keys[i].RateLimit.MaxQueueSize = *maxQueueSize
				}
				if queueTimeout != nil {
					h.cfg.AccessKeyLimits.Keys[i].RateLimit.QueueTimeout = *queueTimeout
				}
			}
			return
		}
	}

	// Key not found, only create new entry if we have rate limit values
	if !shouldClear {
		rl := &config.RateLimitKeyConfig{}
		if minInterval != nil {
			rl.MinInterval = *minInterval
		}
		if maxQueueSize != nil {
			rl.MaxQueueSize = *maxQueueSize
		}
		if queueTimeout != nil {
			rl.QueueTimeout = *queueTimeout
		}
		newEntry := config.AccessKeyLimit{
			APIKey:    apiKey,
			RateLimit: rl,
		}
		h.cfg.AccessKeyLimits.Keys = append(h.cfg.AccessKeyLimits.Keys, newEntry)
	}
}

// ResetAccessKeyLimit resets the accumulated cost/requests for a specific API key to zero.
// POST /v0/management/access-key-limits/keys/:key/reset
// Body: {"type": "cost" | "requests" | "all"} - defaults to "all" if not specified
func (h *Handler) ResetAccessKeyLimit(c *gin.Context) {
	if costManager == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "cost manager not initialized"})
		return
	}

	apiKey := c.Param("key")
	if apiKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "api key is required"})
		return
	}

	var body struct {
		Type string `json:"type"`
	}
	// Ignore parse errors - default to "all"
	_ = c.ShouldBindJSON(&body)

	resetType := body.Type
	if resetType == "" {
		resetType = "all"
	}

	var err error
	var message string

	switch resetType {
	case "cost":
		err = costManager.ResetKey(apiKey)
		message = "accumulated cost reset to 0"
	case "requests":
		err = costManager.ResetRequestCount(apiKey)
		message = "request count reset to 0"
	case "all":
		err = costManager.ResetAll(apiKey)
		message = "accumulated cost and request count reset to 0"
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid type: expected 'cost', 'requests', or 'all'"})
		return
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reset: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":  "ok",
		"message": message,
	})
}

// ResetAllAccessKeyLimits resets the accumulated cost/requests for ALL API keys to zero.
// POST /v0/management/access-key-limits/reset-all
// Body: {\"type\": \"cost\" | \"requests\" | \"all\"} - defaults to \"all\" if not specified
func (h *Handler) ResetAllAccessKeyLimits(c *gin.Context) {
	if costManager == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "cost manager not initialized"})
		return
	}

	var body struct {
		Type string `json:"type"`
	}
	// Ignore parse errors - default to \"all\"
	_ = c.ShouldBindJSON(&body)

	resetType := body.Type
	if resetType == "" {
		resetType = "all"
	}

	var count int
	var err error
	var message string

	switch resetType {
	case "all":
		count, err = costManager.ResetAllKeys()
		message = "all keys reset (cost and request count)"
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid type: expected 'all'"})
		return
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reset: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":     "ok",
		"message":    message,
		"keys_reset": count,
	})
}

// DeleteAccessKeyLimit removes the cost/request limit configuration for a specific API key.
// It removes the key from the config's access-key-limits.keys and clears accumulated data.
// DELETE /v0/management/access-key-limits/keys/:key
func (h *Handler) DeleteAccessKeyLimit(c *gin.Context) {
	if costManager == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "cost manager not initialized"})
		return
	}

	apiKey := c.Param("key")
	if apiKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "api key is required"})
		return
	}

	// Lock to ensure thread-safe modification of config
	h.mu.Lock()
	found := false
	for i, keyLimit := range h.cfg.AccessKeyLimits.Keys {
		if keyLimit.APIKey == apiKey {
			h.cfg.AccessKeyLimits.Keys = append(h.cfg.AccessKeyLimits.Keys[:i], h.cfg.AccessKeyLimits.Keys[i+1:]...)
			found = true
			break
		}
	}
	h.mu.Unlock()

	// Also remove accumulated data via costManager
	costManager.RemoveLimit(apiKey)

	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "limit not found for this key"})
		return
	}

	h.persist(c)
}
