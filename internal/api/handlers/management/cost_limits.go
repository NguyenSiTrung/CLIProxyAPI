package management

import (
	"net/http"

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

	type keyInfo struct {
		APIKey            string  `json:"api_key"`
		MaxCost           float64 `json:"max_cost"`
		CurrentCost       float64 `json:"current_cost"`
		MaxRequests       int64   `json:"max_requests"`
		CurrentRequests   int64   `json:"current_requests"`
		AutoResetInterval string  `json:"auto_reset_interval,omitempty"`
		NextResetTime     string  `json:"next_reset_time,omitempty"`
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
		if k.AutoResetInterval != "" && k.AutoResetInterval != "none" {
			nextReset := costManager.GetNextResetTime(k.APIKey)
			if !nextReset.IsZero() {
				info.NextResetTime = nextReset.Format("2006-01-02T15:04:05Z07:00")
			}
		}
		keyInfos[i] = info
	}

	c.JSON(http.StatusOK, gin.H{
		"enabled":              costManager.IsEnabled(),
		"default_max_cost":     costManager.GetDefaultMaxCost(),
		"default_max_requests": costManager.GetDefaultMaxRequests(),
		"keys":                 keyInfos,
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

	// Modify h.cfg directly to ensure persist saves the correct config.
	// The OnConfigChange callback will sync this to costManager via SetConfig.
	h.cfg.AccessKeyLimits.Enabled = *body.Enabled
	h.persist(c)
}

// PutAccessKeyLimit updates the cost/request limit for a specific API key.
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

	var body struct {
		MaxCost           *float64 `json:"max_cost"`
		MaxRequests       *int64   `json:"max_requests"`
		AutoResetInterval *string  `json:"auto_reset_interval"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON body"})
		return
	}

	if body.MaxCost == nil && body.MaxRequests == nil && body.AutoResetInterval == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "at least one of max_cost, max_requests, or auto_reset_interval is required"})
		return
	}

	// Modify h.cfg directly to ensure persist saves the correct config.
	// The OnConfigChange callback will sync this to costManager via SetConfig.
	// This fixes a bug where costManager.cfg and h.cfg could be different objects
	// after hot-reloads, causing changes to be lost when persist saves h.cfg.
	h.updateAccessKeyLimit(apiKey, body.MaxCost, body.MaxRequests, body.AutoResetInterval)
	h.persist(c)
}

// updateAccessKeyLimit updates the limit configuration in h.cfg for a specific API key.
// It finds or creates the key entry and applies the provided limit changes.
func (h *Handler) updateAccessKeyLimit(apiKey string, maxCost *float64, maxRequests *int64, autoResetInterval *string) {
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

	// Remove from h.cfg directly to ensure persist saves the correct config
	found := false
	for i, keyLimit := range h.cfg.AccessKeyLimits.Keys {
		if keyLimit.APIKey == apiKey {
			h.cfg.AccessKeyLimits.Keys = append(h.cfg.AccessKeyLimits.Keys[:i], h.cfg.AccessKeyLimits.Keys[i+1:]...)
			found = true
			break
		}
	}

	// Also remove accumulated data via costManager
	costManager.RemoveLimit(apiKey)

	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "limit not found for this key"})
		return
	}

	h.persist(c)
}
