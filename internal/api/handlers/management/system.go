// Package management provides the management API handlers for system metrics.
package management

import (
	"fmt"
	"net/http"
	"runtime"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/buildinfo"
)

// SystemMetrics holds system resource information.
type SystemMetrics struct {
	Uptime         string  `json:"uptime"`
	CPU            float64 `json:"cpu_percent"`
	MemoryUsed     uint64  `json:"memory_used_bytes"`
	MemoryTotal    uint64  `json:"memory_total_bytes"`
	MemoryPercent  float64 `json:"memory_percent"`
	DiskUsed       uint64  `json:"disk_used_bytes"`
	DiskTotal      uint64  `json:"disk_total_bytes"`
	DiskPercent    float64 `json:"disk_percent"`
	Goroutines     int     `json:"goroutines"`
	Timestamp      int64   `json:"timestamp"`
}

// GetSystemMetrics returns current system resource usage.
func (h *Handler) GetSystemMetrics(c *gin.Context) {
	metrics := collectSystemMetrics()
	c.JSON(http.StatusOK, metrics)
}

// collectSystemMetrics gathers CPU, memory, disk, and uptime information.
func collectSystemMetrics() SystemMetrics {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	// Calculate uptime
	uptime := time.Since(buildinfo.ServerStartTime)

	// Get disk usage (root filesystem)
	var disk syscall.Statfs_t
	diskUsed := uint64(0)
	diskTotal := uint64(0)
	if err := syscall.Statfs("/", &disk); err == nil {
		diskTotal = disk.Blocks * uint64(disk.Bsize)
		diskUsed = (disk.Blocks - disk.Bfree) * uint64(disk.Bsize)
	}

	// Calculate memory from runtime stats (approximate)
	memTotal := m.Sys
	memUsed := m.Sys - m.Frees - m.Mallocs // approximate used

	// CPU percent - this is a point-in-time estimate
	// For more accurate CPU, you'd need to sample over time
	var cpuPercent float64
	// Simple estimate based on goroutine count as a proxy
	if runtime.NumGoroutine() > 100 {
		cpuPercent = float64(runtime.NumGoroutine()) / 10.0
		if cpuPercent > 100 {
			cpuPercent = 100
		}
	} else {
		cpuPercent = float64(runtime.NumGoroutine()) / 5.0
	}

	diskPercent := 0.0
	if diskTotal > 0 {
		diskPercent = float64(diskUsed) / float64(diskTotal) * 100
	}

	memPercent := 0.0
	if memTotal > 0 {
		memPercent = float64(memUsed) / float64(memTotal) * 100
	}

	return SystemMetrics{
		Uptime:         formatUptime(uptime),
		CPU:            cpuPercent,
		MemoryUsed:     memUsed,
		MemoryTotal:    memTotal,
		MemoryPercent:  memPercent,
		DiskUsed:       diskUsed,
		DiskTotal:      diskTotal,
		DiskPercent:    diskPercent,
		Goroutines:     runtime.NumGoroutine(),
		Timestamp:      time.Now().UnixMilli(),
	}
}

// formatUptime returns a human-readable uptime string.
func formatUptime(d time.Duration) string {
	d = d.Round(time.Second)
	h := d / time.Hour
	d -= h * time.Hour
	m := d / time.Minute
	d -= m * time.Minute
	s := d / time.Second

	if h > 24 {
	 days := h / 24
	 h = h % 24
	 return fmt.Sprintf("%dd %dh %dm", days, h, m)
	}

	if h > 0 {
		return fmt.Sprintf("%dh %dm %ds", h, m, s)
	}
	if m > 0 {
		return fmt.Sprintf("%dm %ds", m, s)
	}
	return fmt.Sprintf("%ds", s)
}
