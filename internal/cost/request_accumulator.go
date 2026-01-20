// Package cost provides cost calculation and tracking for API requests.
package cost

import (
	"encoding/json"
	"os"
	"sync"
)

// RequestAccumulator tracks accumulated request counts per API key.
type RequestAccumulator struct {
	mu       sync.RWMutex
	counts   map[string]int64
	inflight map[string]int64 // in-memory reservations (not persisted; resets on restart)
}

// NewRequestAccumulator creates a new RequestAccumulator.
func NewRequestAccumulator() *RequestAccumulator {
	return &RequestAccumulator{
		counts:   make(map[string]int64),
		inflight: make(map[string]int64),
	}
}

// Add increments the request count for an API key by the given amount.
func (r *RequestAccumulator) Add(apiKey string, count int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.counts[apiKey] += count
}

// CheckAndAdd increments the request count for an API key if it has not
// reached the provided limit. When limit is 0, it behaves like Add().
// It returns whether the increment was applied and the resulting count.
func (r *RequestAccumulator) CheckAndAdd(apiKey string, limit int64) (bool, int64) {
	r.mu.Lock()
	defer r.mu.Unlock()

	current := r.counts[apiKey]
	if limit > 0 && current >= limit {
		return false, current
	}

	current++
	r.counts[apiKey] = current
	return true, current
}

// TryReserve attempts to reserve a slot for a request. It checks if the combined
// count of persisted requests plus in-flight reservations is below the limit.
// If allowed, it increments the inflight counter and returns true.
// When limit is 0 (unlimited), it always allows the reservation.
// Returns: allowed, current persisted count, limit.
func (r *RequestAccumulator) TryReserve(apiKey string, limit int64) (bool, int64) {
	r.mu.Lock()
	defer r.mu.Unlock()

	current := r.counts[apiKey]
	inflight := r.inflight[apiKey]
	total := current + inflight

	if limit > 0 && total >= limit {
		return false, current
	}

	r.inflight[apiKey] = inflight + 1
	return true, current
}

// Complete finalizes a reserved request. It decrements the inflight counter
// and, if success is true, increments the persisted count.
// Returns the new persisted count.
func (r *RequestAccumulator) Complete(apiKey string, success bool) int64 {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.inflight[apiKey] > 0 {
		r.inflight[apiKey]--
	}

	if success {
		r.counts[apiKey]++
	}

	return r.counts[apiKey]
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

// Delete removes an API key from the accumulator entirely.
func (r *RequestAccumulator) Delete(apiKey string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.counts, apiKey)
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
