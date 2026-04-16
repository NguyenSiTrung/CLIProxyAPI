// Package cost provides cost calculation and tracking for API requests.
package cost

import (
	"encoding/json"
	"os"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
)

// ResetInterval represents the auto-reset interval type.
type ResetInterval string

const (
	ResetNone    ResetInterval = "none"
	ResetHourly  ResetInterval = "hourly"
	ResetDaily   ResetInterval = "daily"
	ResetWeekly  ResetInterval = "weekly"
	ResetMonthly ResetInterval = "monthly"
)

// ParseResetInterval converts a string to ResetInterval.
// Returns ResetNone for empty or invalid values.
// Custom durations (e.g. "5h", "90m") are accepted.
func ParseResetInterval(s string) ResetInterval {
	switch s {
	case "hourly":
		return ResetHourly
	case "daily":
		return ResetDaily
	case "weekly":
		return ResetWeekly
	case "monthly":
		return ResetMonthly
	default:
		if isCustomResetDuration(s) {
			return ResetInterval(s)
		}
		return ResetNone
	}
}

// AutoResetState tracks the last reset timestamp per API key.
type AutoResetState struct {
	mu         sync.RWMutex
	lastResets map[string]time.Time
}

// NewAutoResetState creates a new AutoResetState.
func NewAutoResetState() *AutoResetState {
	return &AutoResetState{
		lastResets: make(map[string]time.Time),
	}
}

// GetLastReset returns the last reset time for an API key.
// Returns zero time if the key has never been reset.
func (s *AutoResetState) GetLastReset(apiKey string) time.Time {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.lastResets[apiKey]
}

// SetLastReset updates the last reset time for an API key.
func (s *AutoResetState) SetLastReset(apiKey string, t time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastResets[apiKey] = t
}

// GetAll returns a copy of all last reset times.
func (s *AutoResetState) GetAll() map[string]time.Time {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make(map[string]time.Time, len(s.lastResets))
	for k, v := range s.lastResets {
		result[k] = v
	}
	return result
}

// SaveToFile persists the auto-reset state to a JSON file.
func (s *AutoResetState) SaveToFile(path string) error {
	s.mu.RLock()
	defer s.mu.RUnlock()

	data, err := json.MarshalIndent(s.lastResets, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

// LoadFromFile restores auto-reset state from a JSON file.
func (s *AutoResetState) LoadFromFile(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	var lastResets map[string]time.Time
	if err := json.Unmarshal(data, &lastResets); err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastResets = lastResets
	return nil
}

// NextResetTime calculates the next reset time based on the interval.
// For a given lastReset time and interval, returns when the next reset should occur.
func NextResetTime(lastReset time.Time, interval ResetInterval) time.Time {
	if interval == ResetNone {
		return time.Time{}
	}

	switch interval {
	case ResetHourly:
		return lastReset.Add(time.Hour)
	case ResetDaily:
		return lastReset.AddDate(0, 0, 1)
	case ResetWeekly:
		return lastReset.AddDate(0, 0, 7)
	case ResetMonthly:
		return lastReset.AddDate(0, 1, 0)
	default:
		if duration, ok := parseResetDuration(string(interval)); ok {
			return lastReset.Add(duration)
		}
		return time.Time{}
	}
}

// ShouldReset determines if a reset should occur based on the last reset time and interval.
func ShouldReset(lastReset time.Time, interval ResetInterval, now time.Time) bool {
	if interval == ResetNone {
		return false
	}

	if lastReset.IsZero() {
		return false
	}

	nextReset := NextResetTime(lastReset, interval)
	return !nextReset.IsZero() && now.After(nextReset)
}

func isCustomResetDuration(value string) bool {
	_, ok := parseResetDuration(value)
	return ok
}

func parseResetDuration(value string) (time.Duration, bool) {
	if value == "" {
		return 0, false
	}
	duration, err := time.ParseDuration(value)
	if err != nil {
		return 0, false
	}
	if duration <= 0 {
		return 0, false
	}
	return duration, true
}

// AutoResetScheduler manages background auto-reset operations.
type AutoResetScheduler struct {
	mu          sync.Mutex
	state       *AutoResetState
	ticker      *time.Ticker
	stopCh      chan struct{}
	running     bool
	checkFn     func()
	checkPeriod time.Duration
	stateFile   string
}

// NewAutoResetScheduler creates a new AutoResetScheduler.
// checkPeriod determines how often to check for resets (default: 1 minute).
// stateFile is the path to persist reset timestamps (empty to disable persistence).
func NewAutoResetScheduler(stateFile string, checkPeriod time.Duration) *AutoResetScheduler {
	if checkPeriod == 0 {
		checkPeriod = time.Minute
	}
	s := &AutoResetScheduler{
		state:       NewAutoResetState(),
		checkPeriod: checkPeriod,
		stateFile:   stateFile,
	}
	if stateFile != "" {
		_ = s.state.LoadFromFile(stateFile)
	}
	return s
}

// SetCheckFunction sets the function to call during each check cycle.
// This function should check all keys and perform resets as needed.
func (s *AutoResetScheduler) SetCheckFunction(fn func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.checkFn = fn
}

// Start begins the background ticker for checking auto-resets.
func (s *AutoResetScheduler) Start() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.running {
		return
	}

	s.ticker = time.NewTicker(s.checkPeriod)
	s.stopCh = make(chan struct{})
	s.running = true

	go func() {
		for {
			select {
			case <-s.ticker.C:
				if s.checkFn != nil {
					s.checkFn()
				}
			case <-s.stopCh:
				return
			}
		}
	}()

	logrus.Info("Auto-reset scheduler started")
}

// Stop halts the background ticker.
func (s *AutoResetScheduler) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.running {
		return
	}

	s.ticker.Stop()
	close(s.stopCh)
	s.running = false

	if s.stateFile != "" {
		if err := s.state.SaveToFile(s.stateFile); err != nil {
			logrus.Errorf("Failed to save auto-reset state: %v", err)
		}
	}

	logrus.Info("Auto-reset scheduler stopped")
}

// State returns the underlying AutoResetState for direct access.
func (s *AutoResetScheduler) State() *AutoResetState {
	return s.state
}

// IsRunning returns whether the scheduler is currently running.
func (s *AutoResetScheduler) IsRunning() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.running
}

// SaveState persists the current state to disk.
func (s *AutoResetScheduler) SaveState() error {
	if s.stateFile == "" {
		return nil
	}
	return s.state.SaveToFile(s.stateFile)
}

// Cancel removes a key from the auto-reset state, stopping any future resets for that key.
func (s *AutoResetScheduler) Cancel(apiKey string) {
	s.state.mu.Lock()
	defer s.state.mu.Unlock()
	delete(s.state.lastResets, apiKey)
}
