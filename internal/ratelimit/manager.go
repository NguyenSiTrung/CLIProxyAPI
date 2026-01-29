package ratelimit

import (
	"context"
	"sync"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
)

// Manager manages rate limit workers for all access keys.
type Manager struct {
	mu           sync.Mutex
	workers      map[string]*Worker
	globalConfig *config.RateLimitConfig
	keyConfigs   map[string]*config.RateLimitKeyConfig
	stopCh       chan struct{}
	cleanupDone  chan struct{}
	idleTimeout  time.Duration
}

// ManagerConfig holds configuration for the Manager.
type ManagerConfig struct {
	GlobalConfig *config.RateLimitConfig
	KeyConfigs   map[string]*config.RateLimitKeyConfig
	IdleTimeout  time.Duration
}

// NewManager creates a new rate limit manager.
func NewManager(cfg ManagerConfig) *Manager {
	if cfg.IdleTimeout == 0 {
		cfg.IdleTimeout = 5 * time.Minute
	}
	m := &Manager{
		workers:      make(map[string]*Worker),
		globalConfig: cfg.GlobalConfig,
		keyConfigs:   cfg.KeyConfigs,
		stopCh:       make(chan struct{}),
		cleanupDone:  make(chan struct{}),
		idleTimeout:  cfg.IdleTimeout,
	}
	go m.cleanupLoop()
	return m
}

// IsEnabled returns whether rate limiting is enabled.
func (m *Manager) IsEnabled() bool {
	return m.globalConfig != nil && m.globalConfig.Enabled
}

// Enqueue enqueues a request for the given access key.
// Returns a channel that will be closed when the request can proceed.
// The QueueItem.Proceed field indicates whether to continue with the request.
func (m *Manager) Enqueue(ctx context.Context, apiKey string) (*QueueItem, error) {
	worker := m.getOrCreateWorker(apiKey)

	item := &QueueItem{
		Context: ctx,
		Done:    make(chan struct{}),
	}

	if !worker.Enqueue(item) {
		return nil, ErrQueueFull
	}

	return item, nil
}

// GetWorkerStatus returns status info about a specific worker.
func (m *Manager) GetWorkerStatus(apiKey string) (queueLen int, lastRequest time.Time, exists bool) {
	m.mu.Lock()
	worker, ok := m.workers[apiKey]
	m.mu.Unlock()

	if !ok {
		return 0, time.Time{}, false
	}

	return worker.QueueLen(), worker.LastRequestTime(), true
}

// GetAllWorkersStatus returns status info about all workers.
func (m *Manager) GetAllWorkersStatus() map[string]WorkerStatus {
	m.mu.Lock()
	result := make(map[string]WorkerStatus, len(m.workers))
	for apiKey, worker := range m.workers {
		result[apiKey] = WorkerStatus{
			QueueLen:    worker.QueueLen(),
			LastRequest: worker.LastRequestTime(),
			Running:     worker.IsRunning(),
		}
	}
	m.mu.Unlock()
	return result
}

// Stop gracefully shuts down all workers.
func (m *Manager) Stop() {
	close(m.stopCh)
	<-m.cleanupDone

	m.mu.Lock()
	for _, worker := range m.workers {
		worker.Stop()
	}
	m.workers = make(map[string]*Worker)
	m.mu.Unlock()
}

func (m *Manager) getOrCreateWorker(apiKey string) *Worker {
	m.mu.Lock()
	defer m.mu.Unlock()

	if worker, ok := m.workers[apiKey]; ok {
		return worker
	}

	keyCfg := m.keyConfigs[apiKey]
	workerCfg := ResolveWorkerConfig(m.globalConfig, keyCfg)
	worker := NewWorker(apiKey, workerCfg)
	worker.Start()
	m.workers[apiKey] = worker
	return worker
}

func (m *Manager) cleanupLoop() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	defer close(m.cleanupDone)

	for {
		select {
		case <-m.stopCh:
			return
		case <-ticker.C:
			m.cleanupIdleWorkers()
		}
	}
}

func (m *Manager) cleanupIdleWorkers() {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now()
	for apiKey, worker := range m.workers {
		if worker.QueueLen() == 0 && now.Sub(worker.LastRequestTime()) > m.idleTimeout {
			worker.Stop()
			delete(m.workers, apiKey)
		}
	}
}

// WorkerStatus holds status information for a single worker.
type WorkerStatus struct {
	QueueLen    int
	LastRequest time.Time
	Running     bool
}
