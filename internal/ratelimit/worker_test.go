package ratelimit

import (
	"context"
	"testing"
	"time"
)

func TestWorker_RespectsMinInterval(t *testing.T) {
	minInterval := 50 * time.Millisecond
	worker := NewWorker("test-key", WorkerConfig{
		MinInterval:  minInterval,
		MaxQueueSize: 10,
		QueueTimeout: time.Second,
	})
	worker.Start()
	defer worker.Stop()

	ctx := context.Background()

	item1 := &QueueItem{Context: ctx, Done: make(chan struct{})}
	if !worker.Enqueue(item1) {
		t.Fatal("failed to enqueue first item")
	}
	<-item1.Done
	if !item1.Proceed {
		t.Fatalf("first item should proceed, got error: %v", item1.Error)
	}
	firstComplete := time.Now()

	item2 := &QueueItem{Context: ctx, Done: make(chan struct{})}
	if !worker.Enqueue(item2) {
		t.Fatal("failed to enqueue second item")
	}
	<-item2.Done
	if !item2.Proceed {
		t.Fatalf("second item should proceed, got error: %v", item2.Error)
	}
	secondComplete := time.Now()

	elapsed := secondComplete.Sub(firstComplete)
	if elapsed < minInterval {
		t.Errorf("expected at least %v between requests, got %v", minInterval, elapsed)
	}
}

func TestWorker_QueueFull(t *testing.T) {
	worker := NewWorker("test-key", WorkerConfig{
		MinInterval:  time.Second,
		MaxQueueSize: 2,
		QueueTimeout: time.Second,
	})

	if !worker.Enqueue(&QueueItem{Context: context.Background(), Done: make(chan struct{})}) {
		t.Error("first enqueue should succeed")
	}
	if !worker.Enqueue(&QueueItem{Context: context.Background(), Done: make(chan struct{})}) {
		t.Error("second enqueue should succeed")
	}

	if worker.Enqueue(&QueueItem{Context: context.Background(), Done: make(chan struct{})}) {
		t.Error("third enqueue should fail when queue is full")
	}
}

func TestWorker_QueueTimeout(t *testing.T) {
	worker := NewWorker("test-key", WorkerConfig{
		MinInterval:  100 * time.Millisecond,
		MaxQueueSize: 10,
		QueueTimeout: time.Second,
	})
	worker.Start()
	defer worker.Stop()

	item1 := &QueueItem{Context: context.Background(), Done: make(chan struct{})}
	if !worker.Enqueue(item1) {
		t.Fatal("failed to enqueue first item")
	}
	<-item1.Done

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()

	item2 := &QueueItem{Context: ctx, Done: make(chan struct{})}
	if !worker.Enqueue(item2) {
		t.Fatal("failed to enqueue second item")
	}
	<-item2.Done

	if item2.Proceed {
		t.Error("item should not proceed when context times out")
	}
	if item2.Error != context.DeadlineExceeded {
		t.Errorf("expected context.DeadlineExceeded, got %v", item2.Error)
	}
}

func TestWorker_GracefulShutdown(t *testing.T) {
	worker := NewWorker("test-key", WorkerConfig{
		MinInterval:  time.Second,
		MaxQueueSize: 10,
		QueueTimeout: time.Second,
	})
	worker.Start()

	items := make([]*QueueItem, 3)
	for i := range items {
		items[i] = &QueueItem{Context: context.Background(), Done: make(chan struct{})}
		if !worker.Enqueue(items[i]) {
			t.Fatalf("failed to enqueue item %d", i)
		}
	}

	time.Sleep(10 * time.Millisecond)
	worker.Stop()

	for i, item := range items {
		select {
		case <-item.Done:
		case <-time.After(time.Second):
			t.Fatalf("item %d done channel not closed after stop", i)
		}
	}

	var stoppedCount int
	for _, item := range items {
		if item.Error == ErrWorkerStopped {
			stoppedCount++
		}
	}
	if stoppedCount == 0 {
		t.Error("expected at least one item to receive ErrWorkerStopped")
	}
}

func TestWorker_ContextCancelledBeforeProcessing(t *testing.T) {
	worker := NewWorker("test-key", WorkerConfig{
		MinInterval:  100 * time.Millisecond,
		MaxQueueSize: 10,
		QueueTimeout: time.Second,
	})
	worker.Start()
	defer worker.Stop()

	item1 := &QueueItem{Context: context.Background(), Done: make(chan struct{})}
	if !worker.Enqueue(item1) {
		t.Fatal("failed to enqueue first item")
	}
	<-item1.Done

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	item2 := &QueueItem{Context: ctx, Done: make(chan struct{})}
	if !worker.Enqueue(item2) {
		t.Fatal("failed to enqueue cancelled item")
	}
	<-item2.Done

	if item2.Proceed {
		t.Error("cancelled item should not proceed")
	}
	if item2.Error != context.Canceled {
		t.Errorf("expected context.Canceled, got %v", item2.Error)
	}
}
