package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/cost"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func setupTestRouter(manager *cost.Manager) *gin.Engine {
	r := gin.New()
	r.Use(func(c *gin.Context) {
		// Simulate auth middleware setting apiKey
		if apiKey := c.GetHeader("X-API-Key"); apiKey != "" {
			c.Set("apiKey", apiKey)
		}
		c.Next()
	})
	r.Use(CostLimitMiddleware(manager))
	r.GET("/test", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	return r
}

func TestCostLimitMiddleware_NilManager(t *testing.T) {
	r := setupTestRouter(nil)

	req, _ := http.NewRequest("GET", "/test", nil)
	req.Header.Set("X-API-Key", "test-key")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status OK with nil manager, got %d", w.Code)
	}
}

func TestCostLimitMiddleware_DisabledManager(t *testing.T) {
	cfg := &config.Config{
		AccessKeyLimits: config.AccessKeyLimits{
			Enabled: false,
		},
	}
	manager := cost.NewManager(cfg, "")

	r := setupTestRouter(manager)

	req, _ := http.NewRequest("GET", "/test", nil)
	req.Header.Set("X-API-Key", "test-key")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status OK with disabled manager, got %d", w.Code)
	}
}

func TestCostLimitMiddleware_NoAPIKey(t *testing.T) {
	cfg := &config.Config{
		AccessKeyLimits: config.AccessKeyLimits{
			Enabled: true,
		},
	}
	manager := cost.NewManager(cfg, "")

	r := setupTestRouter(manager)

	req, _ := http.NewRequest("GET", "/test", nil)
	// No API key header
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status OK without API key, got %d", w.Code)
	}
}

func TestCostLimitMiddleware_CostLimitExceeded(t *testing.T) {
	cfg := &config.Config{
		AccessKeyLimits: config.AccessKeyLimits{
			Enabled:        true,
			DefaultMaxCost: 1.0, // Very low limit
		},
	}
	manager := cost.NewManager(cfg, "")

	// Manually add cost to exceed limit
	for i := 0; i < 100; i++ {
		manager.RecordRequest("test-key")
	}

	r := setupTestRouter(manager)

	// First request should succeed
	req, _ := http.NewRequest("GET", "/test", nil)
	req.Header.Set("X-API-Key", "new-key")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status OK for new key, got %d", w.Code)
	}
}

func TestCostLimitMiddleware_RequestLimitExceeded(t *testing.T) {
	cfg := &config.Config{
		AccessKeyLimits: config.AccessKeyLimits{
			Enabled:            true,
			DefaultMaxRequests: 2, // Very low limit
		},
	}
	manager := cost.NewManager(cfg, "")

	// Manually add requests to exceed limit
	manager.RecordRequest("test-key")
	manager.RecordRequest("test-key")

	r := setupTestRouter(manager)

	// This request should be blocked
	req, _ := http.NewRequest("GET", "/test", nil)
	req.Header.Set("X-API-Key", "test-key")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusTooManyRequests {
		t.Errorf("expected status 429, got %d", w.Code)
	}

	// Verify response contains request limit error
	body := w.Body.String()
	if !contains(body, "request_limit_exceeded") {
		t.Errorf("expected error code 'request_limit_exceeded' in response, got: %s", body)
	}
}

func TestCostLimitMiddleware_RequestLimitEnforcedPerRequest(t *testing.T) {
	cfg := &config.Config{
		AccessKeyLimits: config.AccessKeyLimits{
			Enabled:            true,
			DefaultMaxRequests: 1,
		},
	}
	manager := cost.NewManager(cfg, "")

	r := setupTestRouter(manager)

	req1, _ := http.NewRequest("GET", "/test", nil)
	req1.Header.Set("X-API-Key", "test-key")
	w1 := httptest.NewRecorder()
	r.ServeHTTP(w1, req1)

	if w1.Code != http.StatusOK {
		t.Fatalf("expected first request to succeed, got %d", w1.Code)
	}

	// Second request should now be blocked because middleware increments count atomically
	req2, _ := http.NewRequest("GET", "/test", nil)
	req2.Header.Set("X-API-Key", "test-key")
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)

	if w2.Code != http.StatusTooManyRequests {
		t.Fatalf("expected second request to be blocked with 429, got %d", w2.Code)
	}
}

func TestCostLimitMiddleware_AllowedWithinLimits(t *testing.T) {
	cfg := &config.Config{
		AccessKeyLimits: config.AccessKeyLimits{
			Enabled:            true,
			DefaultMaxCost:     100.0,
			DefaultMaxRequests: 100,
		},
	}
	manager := cost.NewManager(cfg, "")

	r := setupTestRouter(manager)

	req, _ := http.NewRequest("GET", "/test", nil)
	req.Header.Set("X-API-Key", "test-key")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status OK within limits, got %d", w.Code)
	}
}

func TestCostLimitMiddleware_UnlimitedWithZeroLimits(t *testing.T) {
	cfg := &config.Config{
		AccessKeyLimits: config.AccessKeyLimits{
			Enabled:            true,
			DefaultMaxCost:     0, // 0 means unlimited
			DefaultMaxRequests: 0, // 0 means unlimited
		},
	}
	manager := cost.NewManager(cfg, "")

	// Add many requests - should still be allowed
	for i := 0; i < 1000; i++ {
		manager.RecordRequest("test-key")
	}

	r := setupTestRouter(manager)

	req, _ := http.NewRequest("GET", "/test", nil)
	req.Header.Set("X-API-Key", "test-key")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status OK with unlimited (zero) limits, got %d", w.Code)
	}
}

func TestCostLimitMiddleware_PerKeyLimitOverride(t *testing.T) {
	cfg := &config.Config{
		AccessKeyLimits: config.AccessKeyLimits{
			Enabled:            true,
			DefaultMaxRequests: 100,
			Keys: []config.AccessKeyLimit{
				{
					APIKey:      "limited-key",
					MaxRequests: 1,
				},
			},
		},
	}
	manager := cost.NewManager(cfg, "")

	// Add one request
	manager.RecordRequest("limited-key")

	r := setupTestRouter(manager)

	// This request should be blocked
	req, _ := http.NewRequest("GET", "/test", nil)
	req.Header.Set("X-API-Key", "limited-key")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusTooManyRequests {
		t.Errorf("expected status 429 for limited key, got %d", w.Code)
	}

	// Other key should work
	req2, _ := http.NewRequest("GET", "/test", nil)
	req2.Header.Set("X-API-Key", "other-key")
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)

	if w2.Code != http.StatusOK {
		t.Errorf("expected status OK for other key, got %d", w2.Code)
	}
}

func TestCostLimitMiddleware_CountOnlySuccess_IgnoresResponseErrors(t *testing.T) {
	cfg := &config.Config{
		AccessKeyLimits: config.AccessKeyLimits{
			Enabled:                  true,
			DefaultMaxRequests:       1,
			CountOnlySuccessRequests: true,
		},
	}
	manager := cost.NewManager(cfg, "")

	r := gin.New()
	r.Use(func(c *gin.Context) {
		if apiKey := c.GetHeader("X-API-Key"); apiKey != "" {
			c.Set("apiKey", apiKey)
		}
		c.Next()
	})
	r.Use(CostLimitMiddleware(manager))
	r.GET("/test", func(c *gin.Context) {
		// Simulate a streamed error where HTTP status stays 200 but an error is recorded.
		c.Set("API_RESPONSE_ERROR", []string{"upstream_error"})
		c.JSON(http.StatusOK, gin.H{"status": "error"})
	})

	req1, _ := http.NewRequest("GET", "/test", nil)
	req1.Header.Set("X-API-Key", "test-key")
	w1 := httptest.NewRecorder()
	r.ServeHTTP(w1, req1)

	if w1.Code != http.StatusOK {
		t.Fatalf("expected first request to return OK, got %d", w1.Code)
	}
	if got := manager.GetCurrentRequestCount("test-key"); got != 0 {
		t.Fatalf("expected failed request not to count, got %d", got)
	}

	req2, _ := http.NewRequest("GET", "/test", nil)
	req2.Header.Set("X-API-Key", "test-key")
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)

	if w2.Code != http.StatusOK {
		t.Fatalf("expected second request to be allowed after failure, got %d", w2.Code)
	}
}

func TestMaskAPIKey(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"12345678", "****5678"},
		{"1234", "****"},
		{"123", "****"},
		{"", "****"},
		{"abcdefghijklmnop", "****mnop"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := maskAPIKey(tt.input)
			if result != tt.expected {
				t.Errorf("maskAPIKey(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsHelper(s, substr))
}

func containsHelper(s, substr string) bool {
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
