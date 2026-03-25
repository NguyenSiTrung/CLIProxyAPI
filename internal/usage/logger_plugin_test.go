package usage

import (
	"context"
	"testing"
	"time"

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

func TestRequestStatisticsRecordIncludesLatency(t *testing.T) {
	stats := NewRequestStatistics()
	stats.Record(context.Background(), coreusage.Record{
		APIKey:      "test-key",
		Model:       "gpt-5.4",
		RequestedAt: time.Date(2026, 3, 20, 12, 0, 0, 0, time.UTC),
		Latency:     1500 * time.Millisecond,
		Detail: coreusage.Detail{
			InputTokens:  10,
			OutputTokens: 20,
			TotalTokens:  30,
		},
	})

	snapshot := stats.Snapshot()
	details := snapshot.APIs["test-key"].Models["gpt-5.4"].Details
	if len(details) != 1 {
		t.Fatalf("details len = %d, want 1", len(details))
	}
	if details[0].LatencyMs != 1500 {
		t.Fatalf("latency_ms = %d, want 1500", details[0].LatencyMs)
	}
}

func TestRequestStatisticsMergeSnapshotDedupIgnoresLatency(t *testing.T) {
	stats := NewRequestStatistics()
	timestamp := time.Date(2026, 3, 20, 12, 0, 0, 0, time.UTC)
	first := StatisticsSnapshot{
		APIs: map[string]APISnapshot{
			"test-key": {
				Models: map[string]ModelSnapshot{
					"gpt-5.4": {
						Details: []RequestDetail{{
							Timestamp: timestamp,
							LatencyMs: 0,
							Source:    "user@example.com",
							AuthIndex: "0",
							Tokens: TokenStats{
								InputTokens:  10,
								OutputTokens: 20,
								TotalTokens:  30,
							},
						}},
					},
				},
			},
		},
	}
	second := StatisticsSnapshot{
		APIs: map[string]APISnapshot{
			"test-key": {
				Models: map[string]ModelSnapshot{
					"gpt-5.4": {
						Details: []RequestDetail{{
							Timestamp: timestamp,
							LatencyMs: 2500,
							Source:    "user@example.com",
							AuthIndex: "0",
							Tokens: TokenStats{
								InputTokens:  10,
								OutputTokens: 20,
								TotalTokens:  30,
							},
						}},
					},
				},
			},
		},
	}

	result := stats.MergeSnapshot(first)
	if result.Added != 1 || result.Skipped != 0 {
		t.Fatalf("first merge = %+v, want added=1 skipped=0", result)
	}

	result = stats.MergeSnapshot(second)
	if result.Added != 0 || result.Skipped != 1 {
		t.Fatalf("second merge = %+v, want added=0 skipped=1", result)
	}

	snapshot := stats.Snapshot()
	details := snapshot.APIs["test-key"].Models["gpt-5.4"].Details
	if len(details) != 1 {
		t.Fatalf("details len = %d, want 1", len(details))
	}
}
