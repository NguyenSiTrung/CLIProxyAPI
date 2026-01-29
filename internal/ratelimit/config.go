package ratelimit

import (
	"time"

	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
)

// ResolveWorkerConfig resolves the effective rate limit configuration for an access key.
// It merges global defaults with per-key overrides.
func ResolveWorkerConfig(globalCfg *config.RateLimitConfig, keyCfg *config.RateLimitKeyConfig) WorkerConfig {
	cfg := WorkerConfig{
		MinInterval:  time.Second,
		MaxQueueSize: config.DefaultRateLimitMaxQueueSize,
		QueueTimeout: 30 * time.Second,
	}

	if globalCfg != nil {
		if d, ok := globalCfg.GetMinInterval(); ok {
			cfg.MinInterval = d
		}
		if d, ok := globalCfg.GetQueueTimeout(); ok {
			cfg.QueueTimeout = d
		}
		cfg.MaxQueueSize = globalCfg.GetMaxQueueSize()
	}

	if keyCfg != nil {
		cfg.MinInterval = keyCfg.GetMinInterval(cfg.MinInterval)
		cfg.QueueTimeout = keyCfg.GetQueueTimeout(cfg.QueueTimeout)
		cfg.MaxQueueSize = keyCfg.GetMaxQueueSize(cfg.MaxQueueSize)
	}

	return cfg
}
