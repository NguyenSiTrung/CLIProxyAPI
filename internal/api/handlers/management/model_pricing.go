package management

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"
)

const modelPricingFilename = "model-pricing.json"

// ModelPricing represents the pricing configuration for a model
type ModelPricing struct {
	Input       float64 `json:"input"`
	Output      float64 `json:"output"`
	CachedInput float64 `json:"cached_input,omitempty"`
}

// GetModelPricing returns the model pricing configuration from the auth directory
func (h *Handler) GetModelPricing(c *gin.Context) {
	authDir := h.cfg.AuthDir
	if authDir == "" {
		c.JSON(http.StatusOK, gin.H{"pricing": map[string]ModelPricing{}})
		return
	}

	filePath := filepath.Join(authDir, modelPricingFilename)
	data, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			c.JSON(http.StatusOK, gin.H{"pricing": map[string]ModelPricing{}})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read pricing config"})
		return
	}

	var pricing map[string]ModelPricing
	if err := json.Unmarshal(data, &pricing); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to parse pricing config"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"pricing": pricing})
}

// PutModelPricing saves the model pricing configuration to the auth directory
func (h *Handler) PutModelPricing(c *gin.Context) {
	authDir := h.cfg.AuthDir
	if authDir == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "auth-dir not configured"})
		return
	}

	var body struct {
		Pricing map[string]ModelPricing `json:"pricing"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	// Ensure auth directory exists
	if err := os.MkdirAll(authDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create auth directory"})
		return
	}

	data, err := json.MarshalIndent(body.Pricing, "", "  ")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to encode pricing config"})
		return
	}

	filePath := filepath.Join(authDir, modelPricingFilename)
	if err := os.WriteFile(filePath, data, 0644); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save pricing config"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// DeleteModelPricing removes the model pricing configuration file
func (h *Handler) DeleteModelPricing(c *gin.Context) {
	authDir := h.cfg.AuthDir
	if authDir == "" {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
		return
	}

	filePath := filepath.Join(authDir, modelPricingFilename)
	if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete pricing config"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
