package cost_test

import (
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/cost"
)

func TestHotReloadLimitChange(t *testing.T) {
	// Initial config: enabled=true, no specific key limits (default unlimited)
	cfg := &config.Config{
		AccessKeyLimits: config.AccessKeyLimits{
			Enabled:            true,
			DefaultMaxCost:     0, // unlimited
			DefaultMaxRequests: 0, // unlimited
			Keys:               []config.AccessKeyLimit{},
		},
	}

	// Create manager with enabled limits but no specific key limits
	m := cost.NewManager(cfg, "")

	apiKey := "sk-test-key-123"

	// Simulate 100 requests
	for i := 0; i < 100; i++ {
		m.RecordRequest(apiKey)
	}

	// Verify counter is 100
	count := m.GetCurrentRequestCount(apiKey)
	t.Logf("Request count after 100 requests: %d", count)
	if count != 100 {
		t.Errorf("Expected 100 requests, got %d", count)
	}

	// Check limit - should be allowed (unlimited)
	allowed, _, _, exceeded := m.CheckLimit(apiKey)
	t.Logf("Before limit change: allowed=%v, exceeded=%v", allowed, exceeded)
	if !allowed {
		t.Error("Should be allowed before limit change")
	}

	// HOT RELOAD: Add limit=1 for this specific key
	newCfg := &config.Config{
		AccessKeyLimits: config.AccessKeyLimits{
			Enabled:            true,
			DefaultMaxCost:     0,
			DefaultMaxRequests: 0,
			Keys: []config.AccessKeyLimit{
				{
					APIKey:      apiKey,
					MaxCost:     0,
					MaxRequests: 1, // Set limit to 1
				},
			},
		},
	}
	m.SetConfig(newCfg)

	// Verify the new limit is being read
	limit := m.GetRequestLimit(apiKey)
	t.Logf("New request limit for key: %d", limit)
	if limit != 1 {
		t.Errorf("Expected limit 1, got %d", limit)
	}

	// Check limit - should be BLOCKED now (100 >= 1)
	allowed, currentCost, costLimit, exceeded := m.CheckLimit(apiKey)
	t.Logf("After limit change: allowed=%v, currentCost=%f, costLimit=%f, exceeded=%v",
		allowed, currentCost, costLimit, exceeded)

	if allowed {
		t.Error("Should be BLOCKED after limit change (100 requests >= limit 1)")
	}
	if exceeded != cost.LimitRequest {
		t.Errorf("Expected LimitRequest exceeded, got %v", exceeded)
	}
}
