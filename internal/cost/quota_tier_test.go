package cost

import (
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
)

func TestMultiTierQuotas(t *testing.T) {
	cfg := &config.Config{
		AccessKeyLimits: config.AccessKeyLimits{
			Enabled: true,
			Keys: []config.AccessKeyLimit{
				{
					APIKey: "multi-tier-key",
					QuotaRules: []config.QuotaRule{
						{
							ID:                "burst",
							MaxRequests:       5,
							AutoResetInterval: "1h",
						},
						{
							ID:                "daily",
							MaxRequests:       20,
							AutoResetInterval: "daily",
						},
					},
				},
				{
					APIKey:            "legacy-key",
					MaxRequests:       10,
					AutoResetInterval: "daily",
				},
			},
		},
	}

	m := NewManager(cfg, "")

	t.Run("multi-tier: blocks when burst tier exceeded", func(t *testing.T) {
		apiKey := "multi-tier-key"

		// Make 5 requests (burst limit)
		for i := 0; i < 5; i++ {
			allowed, _, _, _ := m.CheckAndRecordRequest(apiKey)
			if !allowed {
				t.Errorf("request %d should be allowed", i+1)
			}
		}

		// 6th request should be blocked (burst limit exceeded)
		allowed, current, limit, _ := m.CheckAndRecordRequest(apiKey)
		if allowed {
			t.Errorf("6th request should be blocked by burst tier")
		}
		if current != 5 {
			t.Errorf("expected current=5, got %d", current)
		}
		if limit != 5 {
			t.Errorf("expected limit=5 (burst tier), got %d", limit)
		}

		// Reset burst tier only
		m.resetTier(apiKey, "burst")

		// Now should be allowed again
		allowed, _, _, _ = m.CheckAndRecordRequest(apiKey)
		if !allowed {
			t.Errorf("request after burst reset should be allowed")
		}
	})

	t.Run("multi-tier: increments all tiers", func(t *testing.T) {
		apiKey := "multi-tier-key"

		// Reset all tiers
		m.resetTier(apiKey, "burst")
		m.resetTier(apiKey, "daily")

		// Make a request
		m.CheckAndRecordRequest(apiKey)

		// Check both tiers have been incremented
		burstCount := m.requestAccumulator.Get(tierKey(apiKey, "burst"))
		dailyCount := m.requestAccumulator.Get(tierKey(apiKey, "daily"))

		if burstCount != 1 {
			t.Errorf("burst tier count should be 1, got %d", burstCount)
		}
		if dailyCount != 1 {
			t.Errorf("daily tier count should be 1, got %d", dailyCount)
		}
	})

	t.Run("legacy mode still works", func(t *testing.T) {
		apiKey := "legacy-key"

		// Reset
		m.requestAccumulator.Reset(apiKey)

		// Make 10 requests
		for i := 0; i < 10; i++ {
			allowed, _, _, _ := m.CheckAndRecordRequest(apiKey)
			if !allowed {
				t.Errorf("request %d should be allowed", i+1)
			}
		}

		// 11th should be blocked
		allowed, _, limit, _ := m.CheckAndRecordRequest(apiKey)
		if allowed {
			t.Errorf("11th request should be blocked")
		}
		if limit != 10 {
			t.Errorf("expected limit=10, got %d", limit)
		}
	})

	t.Run("resolveRules returns correct rules", func(t *testing.T) {
		// Multi-tier key
		rules := m.resolveRules("multi-tier-key")
		if len(rules) != 2 {
			t.Errorf("expected 2 rules for multi-tier-key, got %d", len(rules))
		}
		if rules[0].id != "burst" || rules[1].id != "daily" {
			t.Errorf("unexpected rule IDs: %v, %v", rules[0].id, rules[1].id)
		}

		// Legacy key
		rules = m.resolveRules("legacy-key")
		if len(rules) != 1 {
			t.Errorf("expected 1 rule for legacy-key, got %d", len(rules))
		}
		if rules[0].id != "" {
			t.Errorf("legacy key should have empty tier ID, got %q", rules[0].id)
		}
	})

	t.Run("CheckLimitDetailed returns tier info", func(t *testing.T) {
		apiKey := "multi-tier-key"

		// Reset and exhaust burst tier
		m.resetTier(apiKey, "burst")
		m.resetTier(apiKey, "daily")

		for i := 0; i < 5; i++ {
			m.CheckAndRecordRequest(apiKey)
		}

		result := m.CheckLimitDetailed(apiKey)
		if result.Allowed {
			t.Errorf("should not be allowed after burst exhausted")
		}
		if result.TierID != "burst" {
			t.Errorf("expected TierID='burst', got %q", result.TierID)
		}
		if result.Exceeded != LimitRequest {
			t.Errorf("expected LimitRequest exceeded, got %v", result.Exceeded)
		}
	})

	t.Run("GetAllLimits uses most restrictive tier values", func(t *testing.T) {
		apiKey := "multi-tier-key"

		// Reset tiers and add 5 requests (hits burst limit exactly).
		m.resetTier(apiKey, "burst")
		m.resetTier(apiKey, "daily")
		for i := 0; i < 5; i++ {
			m.CheckAndRecordRequest(apiKey)
		}

		limits := m.GetAllLimits()
		var found *KeyLimitInfo
		for i := range limits {
			if limits[i].APIKey == apiKey {
				found = &limits[i]
				break
			}
		}
		if found == nil {
			t.Fatalf("expected to find limit info for %s", apiKey)
		}
		if found.MaxRequests != 5 {
			t.Errorf("expected MaxRequests=5 (burst tier), got %d", found.MaxRequests)
		}
		if found.CurrentRequests != 5 {
			t.Errorf("expected CurrentRequests=5 (burst tier), got %d", found.CurrentRequests)
		}
	})
}

func TestMultiTierQuotaReservation(t *testing.T) {
	cfg := &config.Config{
		AccessKeyLimits: config.AccessKeyLimits{
			Enabled:                  true,
			CountOnlySuccessRequests: true,
			Keys: []config.AccessKeyLimit{
				{
					APIKey: "reserve-key",
					QuotaRules: []config.QuotaRule{
						{
							ID:          "short",
							MaxRequests: 2,
						},
						{
							ID:          "long",
							MaxRequests: 5,
						},
					},
				},
			},
		},
	}

	m := NewManager(cfg, "")

	t.Run("reservation respects all tiers", func(t *testing.T) {
		apiKey := "reserve-key"

		// Reserve 2 slots (short tier limit)
		allowed1, _, _, _ := m.TryReserveRequestSlot(apiKey)
		allowed2, _, _, _ := m.TryReserveRequestSlot(apiKey)

		if !allowed1 || !allowed2 {
			t.Errorf("first 2 reservations should be allowed")
		}

		// 3rd should be blocked by short tier
		allowed3, _, limit, _ := m.TryReserveRequestSlot(apiKey)
		if allowed3 {
			t.Errorf("3rd reservation should be blocked by short tier")
		}
		if limit != 2 {
			t.Errorf("expected limit=2 (short tier), got %d", limit)
		}

		// Complete one reservation as failed (releases slot without counting)
		m.CompleteRequestSlot(apiKey, false)

		// Now should be able to reserve again
		allowed4, _, _, _ := m.TryReserveRequestSlot(apiKey)
		if !allowed4 {
			t.Errorf("reservation should be allowed after release")
		}

		// Complete as success
		m.CompleteRequestSlot(apiKey, true)
		m.CompleteRequestSlot(apiKey, true)

		// Verify both tiers were incremented
		shortCount := m.requestAccumulator.Get(tierKey(apiKey, "short"))
		longCount := m.requestAccumulator.Get(tierKey(apiKey, "long"))

		if shortCount != 2 {
			t.Errorf("short tier should have 2 requests, got %d", shortCount)
		}
		if longCount != 2 {
			t.Errorf("long tier should have 2 requests, got %d", longCount)
		}
	})
}
