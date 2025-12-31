// Package usage provides usage tracking and logging functionality for the CLI Proxy API server.
package usage

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
	log "github.com/sirupsen/logrus"
)

// AutoBackupService handles automatic periodic backup of usage statistics.
type AutoBackupService struct {
	config     config.UsageAutoBackupConfig
	stats      *RequestStatistics
	ctx        context.Context
	cancel     context.CancelFunc
	wg         sync.WaitGroup
	mu         sync.Mutex
	running    bool
	lastBackup time.Time
}

// autoBackupPayload matches the export format from management/usage.go
type autoBackupPayload struct {
	Version    int                `json:"version"`
	ExportedAt time.Time          `json:"exported_at"`
	Usage      StatisticsSnapshot `json:"usage"`
}

// NewAutoBackupService creates a new auto-backup service instance.
func NewAutoBackupService(cfg config.UsageAutoBackupConfig, stats *RequestStatistics) *AutoBackupService {
	return &AutoBackupService{
		config: cfg,
		stats:  stats,
	}
}

// Start begins the automatic backup scheduler.
func (s *AutoBackupService) Start() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.running {
		return nil
	}

	if !s.config.Enabled {
		log.Debug("Auto-backup is disabled")
		return nil
	}

	if err := s.ensureBackupDir(); err != nil {
		return err
	}

	s.ctx, s.cancel = context.WithCancel(context.Background())
	s.running = true

	interval := s.getInterval()
	log.Infof("Starting usage auto-backup service: interval=%v, folder=%s", interval, s.getBackupPath())

	s.wg.Add(1)
	go s.runScheduler(interval)

	return nil
}

// Stop halts the backup scheduler and optionally performs a final backup.
func (s *AutoBackupService) Stop() {
	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return
	}
	s.running = false
	s.cancel()
	s.mu.Unlock()

	s.wg.Wait()

	if s.config.BackupOnShutdown {
		log.Info("Performing shutdown backup of usage statistics...")
		if err := s.performBackup("shutdown"); err != nil {
			log.Errorf("Shutdown backup failed: %v", err)
		} else {
			log.Info("Shutdown backup completed successfully")
		}
	}
}

// PerformBackupNow triggers an immediate backup.
func (s *AutoBackupService) PerformBackupNow() error {
	return s.performBackup("manual")
}

// LastBackupTime returns the timestamp of the last successful backup.
func (s *AutoBackupService) LastBackupTime() time.Time {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastBackup
}

// IsRunning returns whether the service is currently active.
func (s *AutoBackupService) IsRunning() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.running
}

func (s *AutoBackupService) runScheduler(interval time.Duration) {
	defer s.wg.Done()

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
			if err := s.performBackup("scheduled"); err != nil {
				log.Errorf("Scheduled backup failed: %v", err)
			}
		}
	}
}

func (s *AutoBackupService) performBackup(backupType string) error {
	if s.stats == nil {
		return nil
	}

	snapshot := s.stats.Snapshot()
	if snapshot.TotalRequests == 0 {
		log.Debug("Skipping backup: no usage data to backup")
		return nil
	}

	payload := autoBackupPayload{
		Version:    1,
		ExportedAt: time.Now().UTC(),
		Usage:      snapshot,
	}

	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}

	filename := s.generateFilename(backupType)
	filePath := filepath.Join(s.getBackupPath(), filename)

	if err := os.WriteFile(filePath, data, 0644); err != nil {
		return err
	}

	s.mu.Lock()
	s.lastBackup = time.Now()
	s.mu.Unlock()

	log.Infof("Usage backup saved: %s (type=%s, requests=%d)", filePath, backupType, snapshot.TotalRequests)

	if s.config.MaxBackupFiles > 0 {
		s.cleanupOldBackups()
	}

	return nil
}

func (s *AutoBackupService) generateFilename(backupType string) string {
	prefix := s.config.FilenamePrefix
	if prefix == "" {
		prefix = "cliproxy-usage-backup"
	}
	timestamp := time.Now().Format("2006-01-02T15-04-05")
	return prefix + "-" + backupType + "-" + timestamp + ".json"
}

func (s *AutoBackupService) getBackupPath() string {
	path := s.config.FolderPath
	if path == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return "."
		}
		return cwd
	}

	if strings.HasPrefix(path, "~") {
		home, err := os.UserHomeDir()
		if err == nil {
			path = filepath.Join(home, path[1:])
		}
	}

	return path
}

func (s *AutoBackupService) getInterval() time.Duration {
	minutes := s.config.IntervalMinutes
	if minutes <= 0 {
		minutes = 60
	}
	return time.Duration(minutes) * time.Minute
}

func (s *AutoBackupService) ensureBackupDir() error {
	path := s.getBackupPath()
	return os.MkdirAll(path, 0755)
}

func (s *AutoBackupService) cleanupOldBackups() {
	path := s.getBackupPath()
	prefix := s.config.FilenamePrefix
	if prefix == "" {
		prefix = "cliproxy-usage-backup"
	}

	entries, err := os.ReadDir(path)
	if err != nil {
		log.Warnf("Failed to read backup directory for cleanup: %v", err)
		return
	}

	var backupFiles []os.DirEntry
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if strings.HasPrefix(name, prefix) && strings.HasSuffix(name, ".json") {
			backupFiles = append(backupFiles, entry)
		}
	}

	if len(backupFiles) <= s.config.MaxBackupFiles {
		return
	}

	sort.Slice(backupFiles, func(i, j int) bool {
		infoI, errI := backupFiles[i].Info()
		infoJ, errJ := backupFiles[j].Info()
		if errI != nil || errJ != nil {
			return false
		}
		return infoI.ModTime().Before(infoJ.ModTime())
	})

	toDelete := len(backupFiles) - s.config.MaxBackupFiles
	for i := 0; i < toDelete; i++ {
		filePath := filepath.Join(path, backupFiles[i].Name())
		if err := os.Remove(filePath); err != nil {
			log.Warnf("Failed to delete old backup file %s: %v", filePath, err)
		} else {
			log.Debugf("Deleted old backup file: %s", filePath)
		}
	}
}

// BackupFileInfo holds metadata about a backup file.
type BackupFileInfo struct {
	Filename   string    `json:"filename"`
	Size       int64     `json:"size"`
	ModTime    time.Time `json:"mod_time"`
	BackupType string    `json:"backup_type"`
}

// ListBackupFiles returns a list of backup files in the configured folder.
func (s *AutoBackupService) ListBackupFiles() ([]BackupFileInfo, error) {
	if s == nil {
		return nil, nil
	}

	path := s.getBackupPath()
	prefix := s.config.FilenamePrefix
	if prefix == "" {
		prefix = "cliproxy-usage-backup"
	}

	entries, err := os.ReadDir(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []BackupFileInfo{}, nil
		}
		return nil, err
	}

	var files []BackupFileInfo
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasPrefix(name, prefix) || !strings.HasSuffix(name, ".json") {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		backupType := extractBackupType(name, prefix)

		files = append(files, BackupFileInfo{
			Filename:   name,
			Size:       info.Size(),
			ModTime:    info.ModTime(),
			BackupType: backupType,
		})
	}

	sort.Slice(files, func(i, j int) bool {
		return files[i].ModTime.After(files[j].ModTime)
	})

	return files, nil
}

// ReadBackupFile reads and parses a backup file by filename.
func (s *AutoBackupService) ReadBackupFile(filename string) (*autoBackupPayload, error) {
	if s == nil {
		return nil, nil
	}

	if strings.Contains(filename, "/") || strings.Contains(filename, "\\") || strings.Contains(filename, "..") {
		return nil, os.ErrPermission
	}

	path := s.getBackupPath()
	filePath := filepath.Join(path, filename)

	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}

	var payload autoBackupPayload
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, err
	}

	return &payload, nil
}

// GetBackupFolderPath returns the configured backup folder path.
func (s *AutoBackupService) GetBackupFolderPath() string {
	if s == nil {
		return ""
	}
	return s.getBackupPath()
}

func extractBackupType(filename, prefix string) string {
	name := strings.TrimPrefix(filename, prefix+"-")
	name = strings.TrimSuffix(name, ".json")

	parts := strings.Split(name, "-")
	if len(parts) > 0 {
		switch parts[0] {
		case "scheduled", "shutdown", "manual":
			return parts[0]
		}
	}
	return "unknown"
}
