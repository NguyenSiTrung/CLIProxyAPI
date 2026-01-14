package cost

import (
	"context"
	"sync"

	coreusage "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/usage"
)

// CostLimitPlugin implements coreusage.Plugin to record cost for each request.
// It accumulates costs per API key for limit enforcement.
type CostLimitPlugin struct {
	mu      sync.RWMutex
	manager *Manager
}

// NewCostLimitPlugin constructs a new cost limit plugin instance.
func NewCostLimitPlugin() *CostLimitPlugin {
	return &CostLimitPlugin{}
}

// SetManager sets the cost manager for this plugin.
// This should be called during server initialization after the manager is created.
func (p *CostLimitPlugin) SetManager(manager *Manager) {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.manager = manager
}

// HandleUsage implements coreusage.Plugin.
// It records the cost for successful requests and increments request count.
// Counting only happens when access-key-limits.enabled is true.
// Once enabled, all keys are counted regardless of whether they have individual limits set.
func (p *CostLimitPlugin) HandleUsage(ctx context.Context, record coreusage.Record) {
	if p == nil {
		return
	}

	p.mu.RLock()
	manager := p.manager
	p.mu.RUnlock()

	if manager == nil {
		return
	}

	if !manager.IsEnabled() {
		return
	}

	if record.Failed {
		return
	}

	apiKey := record.APIKey
	if apiKey == "" {
		return
	}

	// Record cost (only if cost > 0)
	manager.RecordUsage(apiKey, record.Model, record.Detail)
}

// global plugin instance
var defaultCostLimitPlugin = NewCostLimitPlugin()

// DefaultCostLimitPlugin returns the global cost limit plugin instance.
func DefaultCostLimitPlugin() *CostLimitPlugin {
	return defaultCostLimitPlugin
}

func init() {
	coreusage.RegisterPlugin(DefaultCostLimitPlugin())
}
