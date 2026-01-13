package cost

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestParseResetInterval(t *testing.T) {
	tests := []struct {
		input    string
		expected ResetInterval
	}{
		{"hourly", ResetHourly},
		{"daily", ResetDaily},
		{"weekly", ResetWeekly},
		{"monthly", ResetMonthly},
		{"none", ResetNone},
		{"", ResetNone},
		{"invalid", ResetNone},
		{"HOURLY", ResetNone}, // case-sensitive
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := ParseResetInterval(tt.input)
			if result != tt.expected {
				t.Errorf("ParseResetInterval(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestNextResetTime(t *testing.T) {
	baseTime := time.Date(2026, 1, 13, 10, 30, 0, 0, time.UTC)

	tests := []struct {
		name     string
		interval ResetInterval
		expected time.Time
	}{
		{
			name:     "hourly",
			interval: ResetHourly,
			expected: baseTime.Add(time.Hour),
		},
		{
			name:     "daily",
			interval: ResetDaily,
			expected: time.Date(2026, 1, 14, 10, 30, 0, 0, time.UTC),
		},
		{
			name:     "weekly",
			interval: ResetWeekly,
			expected: time.Date(2026, 1, 20, 10, 30, 0, 0, time.UTC),
		},
		{
			name:     "monthly",
			interval: ResetMonthly,
			expected: time.Date(2026, 2, 13, 10, 30, 0, 0, time.UTC),
		},
		{
			name:     "none returns zero time",
			interval: ResetNone,
			expected: time.Time{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := NextResetTime(baseTime, tt.interval)
			if !result.Equal(tt.expected) {
				t.Errorf("NextResetTime(%v, %v) = %v, want %v", baseTime, tt.interval, result, tt.expected)
			}
		})
	}
}

func TestShouldReset(t *testing.T) {
	baseTime := time.Date(2026, 1, 13, 10, 0, 0, 0, time.UTC)

	tests := []struct {
		name      string
		lastReset time.Time
		interval  ResetInterval
		now       time.Time
		expected  bool
	}{
		{
			name:      "hourly - should reset after 1 hour",
			lastReset: baseTime,
			interval:  ResetHourly,
			now:       baseTime.Add(61 * time.Minute),
			expected:  true,
		},
		{
			name:      "hourly - should not reset before 1 hour",
			lastReset: baseTime,
			interval:  ResetHourly,
			now:       baseTime.Add(30 * time.Minute),
			expected:  false,
		},
		{
			name:      "daily - should reset after 1 day",
			lastReset: baseTime,
			interval:  ResetDaily,
			now:       baseTime.AddDate(0, 0, 1).Add(time.Minute),
			expected:  true,
		},
		{
			name:      "daily - should not reset before 1 day",
			lastReset: baseTime,
			interval:  ResetDaily,
			now:       baseTime.Add(23 * time.Hour),
			expected:  false,
		},
		{
			name:      "weekly - should reset after 1 week",
			lastReset: baseTime,
			interval:  ResetWeekly,
			now:       baseTime.AddDate(0, 0, 7).Add(time.Minute),
			expected:  true,
		},
		{
			name:      "monthly - should reset after 1 month",
			lastReset: baseTime,
			interval:  ResetMonthly,
			now:       baseTime.AddDate(0, 1, 0).Add(time.Minute),
			expected:  true,
		},
		{
			name:      "none - never reset",
			lastReset: baseTime,
			interval:  ResetNone,
			now:       baseTime.AddDate(1, 0, 0),
			expected:  false,
		},
		{
			name:      "zero lastReset - should not reset",
			lastReset: time.Time{},
			interval:  ResetHourly,
			now:       baseTime,
			expected:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ShouldReset(tt.lastReset, tt.interval, tt.now)
			if result != tt.expected {
				t.Errorf("ShouldReset(%v, %v, %v) = %v, want %v",
					tt.lastReset, tt.interval, tt.now, result, tt.expected)
			}
		})
	}
}

func TestAutoResetState(t *testing.T) {
	state := NewAutoResetState()

	t.Run("GetLastReset returns zero for unknown key", func(t *testing.T) {
		result := state.GetLastReset("unknown-key")
		if !result.IsZero() {
			t.Errorf("expected zero time for unknown key, got %v", result)
		}
	})

	t.Run("SetLastReset and GetLastReset", func(t *testing.T) {
		now := time.Now().Round(time.Second)
		state.SetLastReset("test-key", now)

		result := state.GetLastReset("test-key")
		if !result.Equal(now) {
			t.Errorf("GetLastReset() = %v, want %v", result, now)
		}
	})

	t.Run("GetAll returns copy of all resets", func(t *testing.T) {
		now := time.Now().Round(time.Second)
		state.SetLastReset("key1", now)
		state.SetLastReset("key2", now.Add(time.Hour))

		all := state.GetAll()
		if len(all) < 2 {
			t.Errorf("expected at least 2 entries, got %d", len(all))
		}
	})
}

func TestAutoResetStatePersistence(t *testing.T) {
	tmpDir := t.TempDir()
	stateFile := filepath.Join(tmpDir, "auto_reset_state.json")

	now := time.Now().Round(time.Second)

	// Create and save state
	state1 := NewAutoResetState()
	state1.SetLastReset("key1", now)
	state1.SetLastReset("key2", now.Add(time.Hour))

	if err := state1.SaveToFile(stateFile); err != nil {
		t.Fatalf("SaveToFile failed: %v", err)
	}

	// Verify file exists
	if _, err := os.Stat(stateFile); os.IsNotExist(err) {
		t.Fatal("state file was not created")
	}

	// Load state into new instance
	state2 := NewAutoResetState()
	if err := state2.LoadFromFile(stateFile); err != nil {
		t.Fatalf("LoadFromFile failed: %v", err)
	}

	// Verify data matches
	if !state2.GetLastReset("key1").Equal(now) {
		t.Errorf("key1 mismatch: got %v, want %v", state2.GetLastReset("key1"), now)
	}
	if !state2.GetLastReset("key2").Equal(now.Add(time.Hour)) {
		t.Errorf("key2 mismatch: got %v, want %v", state2.GetLastReset("key2"), now.Add(time.Hour))
	}
}

func TestAutoResetStateLoadNonExistent(t *testing.T) {
	state := NewAutoResetState()
	err := state.LoadFromFile("/nonexistent/path/state.json")
	if err != nil {
		t.Errorf("LoadFromFile should not error on non-existent file, got: %v", err)
	}
}

func TestAutoResetScheduler(t *testing.T) {
	tmpDir := t.TempDir()
	stateFile := filepath.Join(tmpDir, "scheduler_state.json")

	t.Run("Start and Stop", func(t *testing.T) {
		scheduler := NewAutoResetScheduler(stateFile, 100*time.Millisecond)

		if scheduler.IsRunning() {
			t.Error("scheduler should not be running initially")
		}

		checkCount := 0
		scheduler.SetCheckFunction(func() {
			checkCount++
		})

		scheduler.Start()
		if !scheduler.IsRunning() {
			t.Error("scheduler should be running after Start")
		}

		// Wait for at least one check
		time.Sleep(250 * time.Millisecond)

		scheduler.Stop()
		if scheduler.IsRunning() {
			t.Error("scheduler should not be running after Stop")
		}

		if checkCount == 0 {
			t.Error("check function should have been called at least once")
		}
	})

	t.Run("Double Start is safe", func(t *testing.T) {
		scheduler := NewAutoResetScheduler("", 100*time.Millisecond)
		scheduler.Start()
		scheduler.Start() // Should not panic
		scheduler.Stop()
	})

	t.Run("Double Stop is safe", func(t *testing.T) {
		scheduler := NewAutoResetScheduler("", 100*time.Millisecond)
		scheduler.Start()
		scheduler.Stop()
		scheduler.Stop() // Should not panic
	})

	t.Run("State is accessible", func(t *testing.T) {
		scheduler := NewAutoResetScheduler("", 100*time.Millisecond)
		state := scheduler.State()
		if state == nil {
			t.Error("State() should not return nil")
		}
	})

	t.Run("SaveState persists data", func(t *testing.T) {
		scheduler := NewAutoResetScheduler(stateFile, 100*time.Millisecond)
		scheduler.State().SetLastReset("test-key", time.Now())

		if err := scheduler.SaveState(); err != nil {
			t.Errorf("SaveState failed: %v", err)
		}

		if _, err := os.Stat(stateFile); os.IsNotExist(err) {
			t.Error("state file should exist after SaveState")
		}
	})
}
