package management

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/usage"
)

type usageExportPayload struct {
	Version    int                      `json:"version"`
	ExportedAt time.Time                `json:"exported_at"`
	Usage      usage.StatisticsSnapshot `json:"usage"`
}

type usageImportPayload struct {
	Version int                      `json:"version"`
	Usage   usage.StatisticsSnapshot `json:"usage"`
}

type usageResetRequest struct {
	Backup bool `json:"backup"`
}

// GetUsageStatistics returns the in-memory request statistics snapshot.
func (h *Handler) GetUsageStatistics(c *gin.Context) {
	var snapshot usage.StatisticsSnapshot
	if h != nil && h.usageStats != nil {
		snapshot = h.usageStats.Snapshot()
	}
	c.JSON(http.StatusOK, gin.H{
		"usage":           snapshot,
		"failed_requests": snapshot.FailureCount,
	})
}

// ExportUsageStatistics returns a complete usage snapshot for backup/migration.
func (h *Handler) ExportUsageStatistics(c *gin.Context) {
	var snapshot usage.StatisticsSnapshot
	if h != nil && h.usageStats != nil {
		snapshot = h.usageStats.Snapshot()
	}
	c.JSON(http.StatusOK, usageExportPayload{
		Version:    1,
		ExportedAt: time.Now().UTC(),
		Usage:      snapshot,
	})
}

// ImportUsageStatistics merges a previously exported usage snapshot into memory.
func (h *Handler) ImportUsageStatistics(c *gin.Context) {
	if h == nil || h.usageStats == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "usage statistics unavailable"})
		return
	}

	data, err := c.GetRawData()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read request body"})
		return
	}

	var payload usageImportPayload
	if err := json.Unmarshal(data, &payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
		return
	}
	if payload.Version != 0 && payload.Version != 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported version"})
		return
	}

	result := h.usageStats.MergeSnapshot(payload.Usage)
	snapshot := h.usageStats.Snapshot()
	c.JSON(http.StatusOK, gin.H{
		"added":           result.Added,
		"skipped":         result.Skipped,
		"total_requests":  snapshot.TotalRequests,
		"failed_requests": snapshot.FailureCount,
	})
}

// ResetUsageStatistics clears in-memory usage statistics and optionally takes a backup before reset.
func (h *Handler) ResetUsageStatistics(c *gin.Context) {
	if h == nil || h.usageStats == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "usage statistics unavailable"})
		return
	}

	backupRequested := false
	if raw := c.Query("backup"); raw != "" {
		if parsed, err := strconv.ParseBool(raw); err == nil {
			backupRequested = parsed
		}
	}

	if c.Request != nil && c.Request.Body != nil && c.Request.ContentLength != 0 {
		var body usageResetRequest
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
			return
		}
		backupRequested = backupRequested || body.Backup
	}

	backupPerformed := false
	var backupTime time.Time
	if backupRequested {
		svc := usage.GetGlobalAutoBackupService()
		if svc == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "auto-backup service not enabled"})
			return
		}

		if err := svc.PerformBackupNow(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "backup failed: " + err.Error()})
			return
		}
		backupPerformed = true
		backupTime = svc.LastBackupTime()
	}

	cleared := h.usageStats.Reset()

	c.JSON(http.StatusOK, gin.H{
		"success":          true,
		"message":          "Usage statistics reset successfully",
		"cleared_requests": cleared.TotalRequests,
		"cleared_tokens":   cleared.TotalTokens,
		"backup_created":   backupPerformed,
		"backup_time":      backupTime,
	})
}

// ListBackupFiles returns a list of available backup files from the server.
func (h *Handler) ListBackupFiles(c *gin.Context) {
	svc := usage.GetGlobalAutoBackupService()
	if svc == nil {
		c.JSON(http.StatusOK, gin.H{
			"enabled":     false,
			"folder_path": "",
			"files":       []usage.BackupFileInfo{},
		})
		return
	}

	files, err := svc.ListBackupFiles()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"enabled":     svc.IsRunning(),
		"folder_path": svc.GetBackupFolderPath(),
		"files":       files,
	})
}

// TriggerManualBackup triggers an immediate backup of usage statistics.
func (h *Handler) TriggerManualBackup(c *gin.Context) {
	svc := usage.GetGlobalAutoBackupService()
	if svc == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "auto-backup service not enabled"})
		return
	}

	if err := svc.PerformBackupNow(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "backup failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Manual backup completed successfully",
	})
}

// ImportBackupFile imports usage statistics from a server-side backup file.
func (h *Handler) ImportBackupFile(c *gin.Context) {
	if h == nil || h.usageStats == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "usage statistics unavailable"})
		return
	}

	filename := c.Query("filename")
	if filename == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "filename is required"})
		return
	}

	svc := usage.GetGlobalAutoBackupService()
	if svc == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "auto-backup service not enabled"})
		return
	}

	payload, err := svc.ReadBackupFile(filename)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read backup file: " + err.Error()})
		return
	}

	result := h.usageStats.MergeSnapshot(payload.Usage)
	snapshot := h.usageStats.Snapshot()
	c.JSON(http.StatusOK, gin.H{
		"added":           result.Added,
		"skipped":         result.Skipped,
		"total_requests":  snapshot.TotalRequests,
		"failed_requests": snapshot.FailureCount,
		"backup_time":     payload.ExportedAt,
	})
}
