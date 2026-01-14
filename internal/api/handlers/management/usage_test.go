package management

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/usage"
	coreusage "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/usage"
)

func TestResetUsageStatistics(t *testing.T) {
	gin.SetMode(gin.TestMode)

	stats := usage.NewRequestStatistics()
	stats.Record(context.Background(), coreusage.Record{
		APIKey: "key-1",
		Model:  "model-a",
		Detail: coreusage.Detail{InputTokens: 10},
	})

	h := &Handler{usageStats: stats}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v0/management/usage/reset", nil)

	h.ResetUsageStatistics(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	if success, ok := resp["success"].(bool); !ok || !success {
		t.Fatalf("expected success true, got %v", resp["success"])
	}

	if cleared, ok := resp["cleared_requests"].(float64); !ok || int64(cleared) != 1 {
		t.Fatalf("unexpected cleared_requests: %v", resp["cleared_requests"])
	}

	if snapshot := stats.Snapshot(); snapshot.TotalRequests != 0 {
		t.Fatalf("stats not cleared after reset: %+v", snapshot)
	}
}
