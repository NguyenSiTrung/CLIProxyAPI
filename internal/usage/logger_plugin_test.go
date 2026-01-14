package usage

import (
	"context"
	"testing"

	coreusage "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/usage"
)

func TestRequestStatisticsReset(t *testing.T) {
	stats := NewRequestStatistics()

	stats.Record(context.Background(), coreusage.Record{
		APIKey: "key-1",
		Model:  "model-a",
		Detail: coreusage.Detail{InputTokens: 5, OutputTokens: 3},
	})
	stats.Record(context.Background(), coreusage.Record{
		APIKey:     "key-1",
		Model:      "model-a",
		Failed:     true,
		Detail:     coreusage.Detail{InputTokens: 2},
		HTTPStatus: 500,
	})

	before := stats.Snapshot()
	if before.TotalRequests != 2 || before.SuccessCount != 1 || before.FailureCount != 1 {
		t.Fatalf("unexpected snapshot before reset: %+v", before)
	}

	cleared := stats.Reset()
	if cleared.TotalRequests != before.TotalRequests || cleared.TotalTokens != before.TotalTokens {
		t.Fatalf("cleared snapshot mismatch: got %+v want %+v", cleared, before)
	}

	after := stats.Snapshot()
	if after.TotalRequests != 0 || after.SuccessCount != 0 || after.FailureCount != 0 || after.TotalTokens != 0 {
		t.Fatalf("usage stats not cleared: %+v", after)
	}
	if len(after.APIs) != 0 || len(after.RequestsByDay) != 0 || len(after.RequestsByHour) != 0 {
		t.Fatalf("usage maps not cleared: %+v", after)
	}
}
