// Package ratelimit implements request rate limiting with pooling/queuing.
// It enforces a minimum time interval between consecutive requests per access key.
package ratelimit

import (
	"context"
	"errors"
	"net/http"
	"time"
)

var (
	// ErrQueueFull is returned when the rate limit queue is at capacity.
	ErrQueueFull = errors.New("rate limit queue full")
	// ErrQueueTimeout is returned when a request times out waiting in queue.
	ErrQueueTimeout = errors.New("rate limit queue timeout")
	// ErrWorkerStopped is returned when the worker is stopped while request is queued.
	ErrWorkerStopped = errors.New("rate limit worker stopped")
)

// QueueItem represents a request waiting in the rate limit queue.
type QueueItem struct {
	// Request is the original HTTP request.
	Request *http.Request
	// ResponseWriter is the response writer for the request.
	ResponseWriter http.ResponseWriter
	// Context is the request context with deadline for queue timeout.
	Context context.Context
	// Done signals when the request has been processed or cancelled.
	Done chan struct{}
	// Error holds any error that occurred during processing.
	Error error
	// Proceed indicates whether the request should proceed to the next handler.
	Proceed bool
}

// WorkerConfig holds the resolved configuration for a rate limit worker.
type WorkerConfig struct {
	// MinInterval is the minimum time between requests.
	MinInterval time.Duration
	// MaxQueueSize is the maximum number of requests to queue.
	MaxQueueSize int
	// QueueTimeout is the maximum time a request waits in queue.
	QueueTimeout time.Duration
}
