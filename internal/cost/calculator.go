// Package cost provides cost calculation and tracking for API requests.
package cost

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
)

// ModelPricing represents the pricing configuration for a model (prices per 1M tokens in USD).
type ModelPricing struct {
	Input       float64 `json:"input"`
	Output      float64 `json:"output"`
	CachedInput float64 `json:"cached_input,omitempty"`
}

// DefaultModelPricing contains fallback pricing for well-known models.
// Prices are per 1M tokens in USD.
var DefaultModelPricing = map[string]ModelPricing{
	// OpenAI Models
	"gpt-4o":             {Input: 2.50, Output: 10.00, CachedInput: 1.25},
	"gpt-4o-2024-08-06":  {Input: 2.50, Output: 10.00, CachedInput: 1.25},
	"gpt-4o-mini":        {Input: 0.15, Output: 0.60, CachedInput: 0.075},
	"gpt-4-turbo":        {Input: 10.00, Output: 30.00},
	"gpt-4":              {Input: 30.00, Output: 60.00},
	"gpt-4.1":            {Input: 2.00, Output: 8.00, CachedInput: 0.50},
	"gpt-4.1-mini":       {Input: 0.40, Output: 1.60, CachedInput: 0.10},
	"gpt-3.5-turbo":      {Input: 0.50, Output: 1.50},
	"o1":                 {Input: 15.00, Output: 60.00},
	"o1-preview":         {Input: 15.00, Output: 60.00},
	"o1-mini":            {Input: 1.10, Output: 4.40},
	"o3":                 {Input: 10.00, Output: 40.00, CachedInput: 2.50},
	"o4-mini":            {Input: 1.10, Output: 4.40, CachedInput: 0.275},

	// Anthropic Claude Models
	"claude-3-5-sonnet-20241022": {Input: 3.00, Output: 15.00, CachedInput: 0.30},
	"claude-3-5-sonnet-20240620": {Input: 3.00, Output: 15.00, CachedInput: 0.30},
	"claude-3-5-haiku-20241022":  {Input: 0.80, Output: 4.00, CachedInput: 0.08},
	"claude-3-opus-20240229":     {Input: 15.00, Output: 75.00, CachedInput: 1.50},
	"claude-sonnet-4-20250514":   {Input: 3.00, Output: 15.00, CachedInput: 0.30},
	"claude-opus-4-20250514":     {Input: 15.00, Output: 75.00, CachedInput: 1.50},

	// Google Gemini Models
	"gemini-1.5-pro":   {Input: 1.25, Output: 5.00, CachedInput: 0.3125},
	"gemini-1.5-flash": {Input: 0.075, Output: 0.30, CachedInput: 0.01875},
	"gemini-2.0-flash": {Input: 0.10, Output: 0.40, CachedInput: 0.025},
	"gemini-2.5-pro":   {Input: 1.25, Output: 10.00, CachedInput: 0.125},
	"gemini-2.5-flash": {Input: 0.15, Output: 0.60, CachedInput: 0.0375},

	// DeepSeek Models
	"deepseek-chat":     {Input: 0.14, Output: 0.28, CachedInput: 0.014},
	"deepseek-reasoner": {Input: 0.55, Output: 2.19},

	// Mistral Models
	"mistral-large-latest": {Input: 2.00, Output: 6.00},
	"mistral-small-latest": {Input: 0.20, Output: 0.60},
}

// Calculator handles cost calculation for API requests.
type Calculator struct {
	mu      sync.RWMutex
	pricing map[string]ModelPricing
}

// NewCalculator creates a new Calculator with default pricing.
func NewCalculator() *Calculator {
	c := &Calculator{
		pricing: make(map[string]ModelPricing),
	}
	for k, v := range DefaultModelPricing {
		c.pricing[k] = v
	}
	return c
}

// LoadPricing fetches pricing data from the /model-pricing endpoint.
// If the endpoint is unavailable, default pricing is used.
func (c *Calculator) LoadPricing(baseURL string) error {
	url := strings.TrimRight(baseURL, "/") + "/model-pricing"

	resp, err := http.Get(url)
	if err != nil {
		return fmt.Errorf("failed to fetch pricing: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("pricing endpoint returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response body: %w", err)
	}

	var response struct {
		Pricing map[string]ModelPricing `json:"pricing"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return fmt.Errorf("failed to parse pricing response: %w", err)
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	// Merge fetched pricing with defaults (fetched takes precedence)
	for k, v := range DefaultModelPricing {
		c.pricing[k] = v
	}
	for k, v := range response.Pricing {
		c.pricing[k] = v
	}

	return nil
}

// SetPricing sets pricing for a specific model.
func (c *Calculator) SetPricing(model string, pricing ModelPricing) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.pricing[model] = pricing
}

// GetPricing returns the pricing for a model, using fuzzy matching if exact match not found.
func (c *Calculator) GetPricing(model string) (ModelPricing, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	// Exact match
	if pricing, ok := c.pricing[model]; ok {
		return pricing, true
	}

	// Try fuzzy matching (check if model name contains a known model key or vice versa)
	lowerModel := strings.ToLower(model)
	for key, pricing := range c.pricing {
		lowerKey := strings.ToLower(key)
		if strings.Contains(lowerModel, lowerKey) || strings.Contains(lowerKey, lowerModel) {
			return pricing, true
		}
	}

	return ModelPricing{}, false
}

// CalculateCost calculates the cost for a request based on token usage.
// Formula: (nonCachedInput/1M * inputPrice) + (output/1M * outputPrice) + (cached/1M * cachedPrice)
// If cachedPrice is not set, it defaults to 10% of inputPrice.
func (c *Calculator) CalculateCost(model string, inputTokens, outputTokens, cachedTokens int64) float64 {
	pricing, ok := c.GetPricing(model)
	if !ok {
		return 0
	}

	// Non-cached input = total input - cached tokens
	nonCachedInput := inputTokens - cachedTokens
	if nonCachedInput < 0 {
		nonCachedInput = 0
	}

	// Calculate costs
	inputCost := float64(nonCachedInput) / 1_000_000 * pricing.Input
	outputCost := float64(outputTokens) / 1_000_000 * pricing.Output

	// Cached input cost (default to 10% of input price if not specified)
	cachedPrice := pricing.CachedInput
	if cachedPrice == 0 && pricing.Input > 0 {
		cachedPrice = pricing.Input * 0.1
	}
	cachedCost := float64(cachedTokens) / 1_000_000 * cachedPrice

	return inputCost + outputCost + cachedCost
}
