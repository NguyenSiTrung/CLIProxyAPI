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
		APIKey      string  `json:"api_key"`
		MaxCost     float64 `json:"max_cost"`
		CurrentCost float64 `json:"current_cost"`
	}

	keys := costManager.GetAllLimits()
	keyInfos := make([]keyInfo, len(keys))
	for i, k := range keys {
		keyInfos[i] = keyInfo{
			APIKey:      k.APIKey,
			MaxCost:     k.MaxCost,
			CurrentCost: k.CurrentCost,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"enabled":          costManager.IsEnabled(),
		"default_max_cost": costManager.GetDefaultMaxCost(),
		"keys":             keyInfos,
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

// PutAccessKeyLimit updates the cost limit for a specific API key.
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
		MaxCost *float64 `json:"max_cost"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.MaxCost == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body: expected {\"max_cost\": number}"})
		return
	}

	costManager.SetLimit(apiKey, *body.MaxCost)
	h.persist(c)
}

// ResetAccessKeyLimit resets the accumulated cost for a specific API key to zero.
// POST /v0/management/access-key-limits/keys/:key/reset
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

	if err := costManager.ResetKey(apiKey); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reset key: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":  "ok",
		"message": "accumulated cost reset to 0",
	})
}
