package ratelimit

import (
	"sync"
	"time"
)

// Worker processes requests for a single access key, enforcing the minimum interval.
type Worker struct {
	mu          sync.Mutex
	config      WorkerConfig
	apiKey      string
	queue       chan *QueueItem
	stopCh      chan struct{}
	lastRequest time.Time
	running     bool
}

// NewWorker creates a new rate limit worker for the given access key.
func NewWorker(apiKey string, cfg WorkerConfig) *Worker {
	return &Worker{
		apiKey:  apiKey,
		config:  cfg,
		queue:   make(chan *QueueItem, cfg.MaxQueueSize),
		stopCh:  make(chan struct{}),
		running: false,
	}
}

// Start begins the worker goroutine that processes queued requests.
func (w *Worker) Start() {
	w.mu.Lock()
	if w.running {
		w.mu.Unlock()
		return
	}
	w.running = true
	w.mu.Unlock()

	go w.run()
}

// Stop gracefully shuts down the worker.
func (w *Worker) Stop() {
	w.mu.Lock()
	if !w.running {
		w.mu.Unlock()
		return
	}
	w.running = false
	w.mu.Unlock()

	close(w.stopCh)
}

// Enqueue attempts to add a request to the queue.
// Returns true if enqueued successfully, false if queue is full.
func (w *Worker) Enqueue(item *QueueItem) bool {
	select {
	case w.queue <- item:
		return true
	default:
		return false
	}
}

// QueueLen returns the current number of items in the queue.
func (w *Worker) QueueLen() int {
	return len(w.queue)
}

// IsRunning returns whether the worker is currently running.
func (w *Worker) IsRunning() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.running
}

// LastRequestTime returns the time of the last processed request.
func (w *Worker) LastRequestTime() time.Time {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.lastRequest
}

func (w *Worker) run() {
	for {
		select {
		case <-w.stopCh:
			w.drainQueue()
			return
		case item := <-w.queue:
			w.processItem(item)
		}
	}
}

func (w *Worker) processItem(item *QueueItem) {
	if item.Context.Err() != nil {
		item.Error = item.Context.Err()
		item.Proceed = false
		close(item.Done)
		return
	}

	w.mu.Lock()
	elapsed := time.Since(w.lastRequest)
	w.mu.Unlock()

	if elapsed < w.config.MinInterval {
		waitTime := w.config.MinInterval - elapsed
		select {
		case <-time.After(waitTime):
		case <-item.Context.Done():
			item.Error = item.Context.Err()
			item.Proceed = false
			close(item.Done)
			return
		case <-w.stopCh:
			item.Error = ErrWorkerStopped
			item.Proceed = false
			close(item.Done)
			return
		}
	}

	if item.Context.Err() != nil {
		item.Error = item.Context.Err()
		item.Proceed = false
		close(item.Done)
		return
	}

	w.mu.Lock()
	w.lastRequest = time.Now()
	w.mu.Unlock()

	item.Proceed = true
	close(item.Done)
}

func (w *Worker) drainQueue() {
	for {
		select {
		case item := <-w.queue:
			item.Error = ErrWorkerStopped
			item.Proceed = false
			close(item.Done)
		default:
			return
		}
	}
}
