package ratelimit

import (
	"context"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
)

func TestManager_CreatesWorkerOnFirstRequest(t *testing.T) {
	globalCfg := &config.RateLimitConfig{
		Enabled:             true,
		DefaultMinInterval:  "100ms",
		DefaultMaxQueueSize: 10,
		DefaultQueueTimeout: "1s",
	}
	m := NewManager(ManagerConfig{
		GlobalConfig: globalCfg,
		IdleTimeout:  time.Minute,
	})
	defer m.Stop()

	_, _, exists := m.GetWorkerStatus("new-key")
	if exists {
		t.Error("worker should not exist before first request")
	}

	ctx := context.Background()
	item, err := m.Enqueue(ctx, "new-key")
	if err != nil {
		t.Fatalf("enqueue failed: %v", err)
	}

	<-item.Done

	_, _, exists = m.GetWorkerStatus("new-key")
	if !exists {
		t.Error("worker should exist after first request")
	}
}

func TestManager_IsEnabled(t *testing.T) {
	tests := []struct {
		name     string
		cfg      *config.RateLimitConfig
		expected bool
	}{
		{
			name:     "nil config",
			cfg:      nil,
			expected: false,
		},
		{
			name: "disabled",
			cfg: &config.RateLimitConfig{
				Enabled: false,
			},
			expected: false,
		},
		{
			name: "enabled",
			cfg: &config.RateLimitConfig{
				Enabled: true,
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := NewManager(ManagerConfig{
				GlobalConfig: tt.cfg,
				IdleTimeout:  time.Minute,
			})
			defer m.Stop()

			if got := m.IsEnabled(); got != tt.expected {
				t.Errorf("IsEnabled() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestManager_PerKeyConfigOverrides(t *testing.T) {
	globalCfg := &config.RateLimitConfig{
		Enabled:             true,
		DefaultMinInterval:  "1s",
		DefaultMaxQueueSize: 100,
		DefaultQueueTimeout: "30s",
	}

	keyConfigs := map[string]*config.RateLimitKeyConfig{
		"custom-key": {
			MinInterval:  "50ms",
			MaxQueueSize: 5,
			QueueTimeout: "5s",
		},
	}

	m := NewManager(ManagerConfig{
		GlobalConfig: globalCfg,
		KeyConfigs:   keyConfigs,
		IdleTimeout:  time.Minute,
	})
	defer m.Stop()

	ctx := context.Background()
	item1, err := m.Enqueue(ctx, "custom-key")
	if err != nil {
		t.Fatalf("enqueue failed: %v", err)
	}
	<-item1.Done

	start := time.Now()
	item2, err := m.Enqueue(ctx, "custom-key")
	if err != nil {
		t.Fatalf("enqueue failed: %v", err)
	}
	<-item2.Done
	elapsed := time.Since(start)

	if elapsed >= 500*time.Millisecond {
		t.Errorf("custom key should have 50ms interval, took %v", elapsed)
	}
}

func TestManager_IdleWorkerCleanup(t *testing.T) {
	globalCfg := &config.RateLimitConfig{
		Enabled:             true,
		DefaultMinInterval:  "10ms",
		DefaultMaxQueueSize: 10,
		DefaultQueueTimeout: "1s",
	}

	m := NewManager(ManagerConfig{
		GlobalConfig: globalCfg,
		IdleTimeout:  50 * time.Millisecond,
	})
	defer m.Stop()

	ctx := context.Background()
	item, err := m.Enqueue(ctx, "idle-key")
	if err != nil {
		t.Fatalf("enqueue failed: %v", err)
	}
	<-item.Done

	_, _, exists := m.GetWorkerStatus("idle-key")
	if !exists {
		t.Error("worker should exist immediately after request")
	}

	time.Sleep(100 * time.Millisecond)
	m.cleanupIdleWorkers()

	_, _, exists = m.GetWorkerStatus("idle-key")
	if exists {
		t.Error("idle worker should have been cleaned up")
	}
}

func TestManager_QueueFull(t *testing.T) {
	globalCfg := &config.RateLimitConfig{
		Enabled:             true,
		DefaultMinInterval:  "1s",
		DefaultMaxQueueSize: 2,
		DefaultQueueTimeout: "1s",
	}

	m := NewManager(ManagerConfig{
		GlobalConfig: globalCfg,
		IdleTimeout:  time.Minute,
	})
	defer m.Stop()

	ctx := context.Background()

	_, err := m.Enqueue(ctx, "test-key")
	if err != nil {
		t.Fatalf("first enqueue failed: %v", err)
	}

	_, err = m.Enqueue(ctx, "test-key")
	if err != nil {
		t.Fatalf("second enqueue failed: %v", err)
	}

	_, err = m.Enqueue(ctx, "test-key")
	if err != ErrQueueFull {
		t.Errorf("expected ErrQueueFull, got %v", err)
	}
}

func TestManager_Stop(t *testing.T) {
	globalCfg := &config.RateLimitConfig{
		Enabled:             true,
		DefaultMinInterval:  "100ms",
		DefaultMaxQueueSize: 10,
		DefaultQueueTimeout: "1s",
	}

	m := NewManager(ManagerConfig{
		GlobalConfig: globalCfg,
		IdleTimeout:  time.Minute,
	})

	ctx := context.Background()
	_, err := m.Enqueue(ctx, "key1")
	if err != nil {
		t.Fatalf("enqueue failed: %v", err)
	}
	_, err = m.Enqueue(ctx, "key2")
	if err != nil {
		t.Fatalf("enqueue failed: %v", err)
	}

	m.Stop()

	status := m.GetAllWorkersStatus()
	if len(status) != 0 {
		t.Errorf("expected 0 workers after stop, got %d", len(status))
	}
}
