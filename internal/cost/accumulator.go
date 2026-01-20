// Package cost provides cost calculation and tracking for API requests.
package cost

import (
	"encoding/json"
	"os"
	"sync"
)

// Accumulator tracks accumulated costs per API key.
type Accumulator struct {
	mu    sync.RWMutex
	costs map[string]float64
}

// NewAccumulator creates a new Accumulator.
func NewAccumulator() *Accumulator {
	return &Accumulator{
		costs: make(map[string]float64),
	}
}

// Add increments the accumulated cost for an API key.
func (a *Accumulator) Add(apiKey string, cost float64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.costs[apiKey] += cost
}

// Get returns the current accumulated cost for an API key.
func (a *Accumulator) Get(apiKey string) float64 {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.costs[apiKey]
}

// Reset clears the accumulated cost for an API key to 0.
func (a *Accumulator) Reset(apiKey string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.costs[apiKey] = 0
}

// Delete removes an API key from the accumulator entirely.
func (a *Accumulator) Delete(apiKey string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.costs, apiKey)
}

// GetAll returns a copy of all accumulated costs.
func (a *Accumulator) GetAll() map[string]float64 {
	a.mu.RLock()
	defer a.mu.RUnlock()
	result := make(map[string]float64, len(a.costs))
	for k, v := range a.costs {
		result[k] = v
	}
	return result
}

// SaveToFile persists the accumulated costs to a JSON file.
func (a *Accumulator) SaveToFile(path string) error {
	a.mu.RLock()
	defer a.mu.RUnlock()

	data, err := json.MarshalIndent(a.costs, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0644)
}

// LoadFromFile restores accumulated costs from a JSON file.
// If the file does not exist, no error is returned and the accumulator remains empty.
func (a *Accumulator) LoadFromFile(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	var costs map[string]float64
	if err := json.Unmarshal(data, &costs); err != nil {
		return err
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	a.costs = costs
	return nil
}
