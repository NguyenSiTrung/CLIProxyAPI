// Package cost provides cost calculation and tracking for API requests.
package cost

import (
	"encoding/json"
	"os"
	"sync"
)

// RequestAccumulator tracks accumulated request counts per API key.
type RequestAccumulator struct {
	mu     sync.RWMutex
	counts map[string]int64
}

// NewRequestAccumulator creates a new RequestAccumulator.
func NewRequestAccumulator() *RequestAccumulator {
	return &RequestAccumulator{
		counts: make(map[string]int64),
	}
}

// Add increments the request count for an API key by the given amount.
func (r *RequestAccumulator) Add(apiKey string, count int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.counts[apiKey] += count
}

// Get returns the current request count for an API key.
func (r *RequestAccumulator) Get(apiKey string) int64 {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.counts[apiKey]
}

// Reset clears the request count for an API key to 0.
func (r *RequestAccumulator) Reset(apiKey string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.counts[apiKey] = 0
}

// GetAll returns a copy of all request counts.
func (r *RequestAccumulator) GetAll() map[string]int64 {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make(map[string]int64, len(r.counts))
	for k, v := range r.counts {
		result[k] = v
	}
	return result
}

// SaveToFile persists the request counts to a JSON file.
func (r *RequestAccumulator) SaveToFile(path string) error {
	r.mu.RLock()
	defer r.mu.RUnlock()
	data, err := json.MarshalIndent(r.counts, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

// LoadFromFile restores request counts from a JSON file.
func (r *RequestAccumulator) LoadFromFile(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var counts map[string]int64
	if err := json.Unmarshal(data, &counts); err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.counts = counts
	return nil
}
