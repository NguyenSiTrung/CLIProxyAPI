package management

import (
	"net/http"

	"github.com/gin-gonic/gin"
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

	costManager.SetEnabled(*body.Enabled)
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

	if body.MaxCost != nil {
		costManager.SetLimit(apiKey, *body.MaxCost)
	}
	if body.MaxRequests != nil {
		costManager.SetRequestLimit(apiKey, *body.MaxRequests)
	}
	if body.AutoResetInterval != nil {
		costManager.SetAutoResetInterval(apiKey, *body.AutoResetInterval)
	}
	h.persist(c)
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
