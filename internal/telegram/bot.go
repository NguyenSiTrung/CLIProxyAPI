// Package telegram provides a Telegram bot for monitoring and managing the CLI Proxy API server.
// It allows users to check server status, usage statistics, available models, and integration docs.
package telegram

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v6/internal/buildinfo"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/registry"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/usage"
	log "github.com/sirupsen/logrus"
)

// Bot represents the Telegram bot instance.
type Bot struct {
	config    config.TelegramConfig
	client    *http.Client
	startTime time.Time
	stopCh    chan struct{}
	wg        sync.WaitGroup
	mu        sync.RWMutex
}

// Update represents a Telegram update.
type Update struct {
	UpdateID int64    `json:"update_id"`
	Message  *Message `json:"message"`
}

// Message represents a Telegram message.
type Message struct {
	MessageID int64  `json:"message_id"`
	Chat      Chat   `json:"chat"`
	Text      string `json:"text"`
	From      *User  `json:"from"`
}

// Chat represents a Telegram chat.
type Chat struct {
	ID   int64  `json:"id"`
	Type string `json:"type"`
}

// User represents a Telegram user.
type User struct {
	ID        int64  `json:"id"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Username  string `json:"username"`
}

// NewBot creates a new Telegram bot instance.
func NewBot(cfg config.TelegramConfig) *Bot {
	return &Bot{
		config:    cfg,
		client:    &http.Client{Timeout: 30 * time.Second},
		startTime: time.Now(),
		stopCh:    make(chan struct{}),
	}
}

// Start begins the bot's update polling loop.
func (b *Bot) Start() {
	if !b.config.Enabled || b.config.Token == "" {
		log.Info("Telegram bot is disabled or no token provided")
		return
	}

	b.wg.Add(1)
	go b.pollUpdates()
	log.Info("Telegram bot started")
}

// Stop gracefully shuts down the bot.
func (b *Bot) Stop() {
	close(b.stopCh)
	b.wg.Wait()
	log.Info("Telegram bot stopped")
}

func (b *Bot) pollUpdates() {
	defer b.wg.Done()

	var offset int64
	for {
		select {
		case <-b.stopCh:
			return
		default:
			updates, err := b.getUpdates(offset)
			if err != nil {
				log.WithError(err).Warn("Failed to get Telegram updates")
				time.Sleep(5 * time.Second)
				continue
			}

			for _, update := range updates {
				if update.Message != nil {
					b.handleMessage(update.Message)
				}
				offset = update.UpdateID + 1
			}
		}
	}
}

func (b *Bot) getUpdates(offset int64) ([]Update, error) {
	url := fmt.Sprintf("https://api.telegram.org/bot%s/getUpdates?offset=%d&timeout=30", b.config.Token, offset)

	ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := b.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		OK     bool     `json:"ok"`
		Result []Update `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	if !result.OK {
		return nil, fmt.Errorf("telegram API returned not OK")
	}

	return result.Result, nil
}

func (b *Bot) handleMessage(msg *Message) {
	if !b.isAllowed(msg.Chat.ID) {
		log.WithField("chat_id", msg.Chat.ID).Warn("Unauthorized Telegram chat access attempt")
		return
	}

	text := strings.TrimSpace(msg.Text)
	if text == "" {
		return
	}

	parts := strings.Fields(text)
	command := strings.ToLower(parts[0])

	var response string
	switch command {
	case "/start", "/help":
		response = b.handleHelp()
	case "/status":
		response = b.handleStatus()
	case "/usage":
		response = b.handleUsage()
	case "/models":
		response = b.handleModels()
	case "/docs":
		response = b.handleDocs()
	case "/user":
		if len(parts) > 1 {
			response = b.handleUserStats(parts[1])
		} else {
			response = "❌ Usage: /user <api_key>\n\nExample: /user myapikey123"
		}
	default:
		if strings.HasPrefix(command, "/") {
			response = fmt.Sprintf("❓ Unknown command: %s\n\nType /help to see available commands.", command)
		}
	}

	if response != "" {
		b.sendMessage(msg.Chat.ID, response)
	}
}

func (b *Bot) isAllowed(chatID int64) bool {
	if len(b.config.AllowedChatIDs) == 0 {
		return true
	}
	for _, id := range b.config.AllowedChatIDs {
		if id == chatID {
			return true
		}
	}
	return false
}

func (b *Bot) sendMessage(chatID int64, text string) {
	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", b.config.Token)

	payload := map[string]interface{}{
		"chat_id":    chatID,
		"text":       text,
		"parse_mode": "HTML",
	}

	body, _ := json.Marshal(payload)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(string(body)))
	if err != nil {
		log.WithError(err).Warn("Failed to create Telegram send message request")
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := b.client.Do(req)
	if err != nil {
		log.WithError(err).Warn("Failed to send Telegram message")
		return
	}
	defer resp.Body.Close()
}

func (b *Bot) handleHelp() string {
	return `🤖 <b>CLI Proxy API Bot</b>

Available commands:

📊 <b>/status</b> - Server status and uptime
📈 <b>/usage</b> - Overall usage statistics
🔍 <b>/user</b> &lt;api_key&gt; - Stats for specific API key
🤖 <b>/models</b> - List available models
📚 <b>/docs</b> - Integration documentation

<i>Monitor your proxy server from anywhere!</i>`
}

func (b *Bot) handleStatus() string {
	uptime := time.Since(b.startTime)

	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)

	stats := usage.GetRequestStatistics().Snapshot()

	serverURL := b.config.ServerURL
	if serverURL == "" {
		serverURL = "Not configured"
	}

	return fmt.Sprintf(`🖥️ <b>Server Status</b>

✅ <b>Status:</b> Online
⏱️ <b>Uptime:</b> %s
📦 <b>Version:</b> %s
🔄 <b>Commit:</b> %s
📅 <b>Built:</b> %s

💾 <b>Memory Usage:</b>
   • Allocated: %.2f MB
   • System: %.2f MB

📊 <b>Request Summary:</b>
   • Total: %d
   • Success: %d
   • Failed: %d
   • Success Rate: %.1f%%

🌐 <b>Server URL:</b> %s`,
		formatDuration(uptime),
		buildinfo.Version,
		truncateString(buildinfo.Commit, 8),
		buildinfo.BuildDate,
		float64(memStats.Alloc)/1024/1024,
		float64(memStats.Sys)/1024/1024,
		stats.TotalRequests,
		stats.SuccessCount,
		stats.FailureCount,
		calculateSuccessRate(stats.SuccessCount, stats.TotalRequests),
		serverURL,
	)
}

func (b *Bot) handleUsage() string {
	stats := usage.GetRequestStatistics().Snapshot()

	var sb strings.Builder
	sb.WriteString("📈 <b>Usage Statistics</b>\n\n")

	sb.WriteString(fmt.Sprintf("📊 <b>Overall:</b>\n"))
	sb.WriteString(fmt.Sprintf("   • Total Requests: %d\n", stats.TotalRequests))
	sb.WriteString(fmt.Sprintf("   • Success: %d (%.1f%%)\n", stats.SuccessCount, calculateSuccessRate(stats.SuccessCount, stats.TotalRequests)))
	sb.WriteString(fmt.Sprintf("   • Failed: %d\n", stats.FailureCount))
	sb.WriteString(fmt.Sprintf("   • Total Tokens: %s\n\n", formatTokens(stats.TotalTokens)))

	if len(stats.RequestsByDay) > 0 {
		sb.WriteString("📅 <b>Last 7 Days:</b>\n")
		days := make([]string, 0, len(stats.RequestsByDay))
		for day := range stats.RequestsByDay {
			days = append(days, day)
		}
		sort.Sort(sort.Reverse(sort.StringSlice(days)))

		count := 0
		for _, day := range days {
			if count >= 7 {
				break
			}
			reqs := stats.RequestsByDay[day]
			tokens := stats.TokensByDay[day]
			sb.WriteString(fmt.Sprintf("   • %s: %d reqs, %s tokens\n", day, reqs, formatTokens(tokens)))
			count++
		}
	}

	if len(stats.APIs) > 0 {
		sb.WriteString(fmt.Sprintf("\n👥 <b>Active API Keys:</b> %d\n", len(stats.APIs)))
	}

	return sb.String()
}

func (b *Bot) handleUserStats(apiKey string) string {
	stats := usage.GetRequestStatistics().Snapshot()

	apiStats, ok := stats.APIs[apiKey]
	if !ok {
		for key, s := range stats.APIs {
			if strings.Contains(strings.ToLower(key), strings.ToLower(apiKey)) {
				apiStats = s
				apiKey = key
				ok = true
				break
			}
		}
	}

	if !ok {
		return fmt.Sprintf("❌ No statistics found for API key: %s\n\nMake sure the key has been used at least once.", apiKey)
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("👤 <b>User Statistics</b>\n\n"))
	sb.WriteString(fmt.Sprintf("🔑 <b>API Key:</b> %s\n\n", truncateString(apiKey, 20)))
	sb.WriteString(fmt.Sprintf("📊 <b>Usage:</b>\n"))
	sb.WriteString(fmt.Sprintf("   • Total Requests: %d\n", apiStats.TotalRequests))
	sb.WriteString(fmt.Sprintf("   • Total Tokens: %s\n\n", formatTokens(apiStats.TotalTokens)))

	if len(apiStats.Models) > 0 {
		sb.WriteString("🤖 <b>Models Used:</b>\n")
		for model, modelStats := range apiStats.Models {
			sb.WriteString(fmt.Sprintf("   • %s: %d reqs, %s tokens\n",
				model, modelStats.TotalRequests, formatTokens(modelStats.TotalTokens)))
		}
	}

	return sb.String()
}

func (b *Bot) handleModels() string {
	modelRegistry := registry.GetGlobalRegistry()
	if modelRegistry == nil {
		return "❌ Model registry not available"
	}

	var sb strings.Builder
	sb.WriteString("🤖 <b>Available Models</b>\n\n")

	providerModels := make(map[string][]string)

	for _, format := range []string{"openai", "gemini", "claude", "vertex"} {
		models := modelRegistry.GetAvailableModels(format)
		for _, m := range models {
			if name, ok := m["id"].(string); ok {
				provider := "other"
				if strings.HasPrefix(name, "gemini") {
					provider = "Gemini"
				} else if strings.HasPrefix(name, "claude") || strings.HasPrefix(name, "copilot-claude") || strings.HasPrefix(name, "droid-claude") {
					provider = "Claude"
				} else if strings.HasPrefix(name, "gpt") || strings.HasPrefix(name, "o1") || strings.HasPrefix(name, "copilot-gpt") {
					provider = "OpenAI"
				} else if strings.Contains(name, "codex") {
					provider = "Codex"
				}
				providerModels[provider] = appendUnique(providerModels[provider], name)
			}
		}
	}

	if len(providerModels) == 0 {
		return "❌ No models currently available"
	}

	providers := []string{"Gemini", "Claude", "OpenAI", "Codex", "other"}
	for _, provider := range providers {
		models, ok := providerModels[provider]
		if !ok || len(models) == 0 {
			continue
		}

		icon := "🔹"
		switch provider {
		case "Gemini":
			icon = "💎"
		case "Claude":
			icon = "🟣"
		case "OpenAI":
			icon = "🟢"
		case "Codex":
			icon = "🔵"
		}

		sb.WriteString(fmt.Sprintf("%s <b>%s</b> (%d):\n", icon, provider, len(models)))
		sort.Strings(models)
		for _, model := range models {
			sb.WriteString(fmt.Sprintf("   • <code>%s</code>\n", model))
		}
		sb.WriteString("\n")
	}

	return sb.String()
}

func (b *Bot) handleDocs() string {
	serverURL := b.config.ServerURL
	if serverURL == "" {
		serverURL = "https://your-server.com"
	}

	return fmt.Sprintf(`📚 <b>Integration Documentation</b>

🔧 <b>Amp IDE Extension</b>
(VSCode, Windsurf, Cursor, Antigravity)

1. Open Settings → Search "amp:url"
2. Set URL: <code>%s</code>
3. Choose "Advanced Settings"
4. Set API Key: <code>YOUR_API_KEY|xxx|amp</code>

<i>Note: |xxx|amp suffix is required.</i>

🔧 <b>Amp CLI</b>
Configure in <code>~/.config/amp/settings.json</code>:
<pre>
{
  "amp.url": "%s",
  "amp.apiKey": "YOUR_API_KEY|xxx|amp"
}
</pre>

🔧 <b>Claude Code</b>
Configure in <code>~/.claude/settings.json</code>:
<pre>
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "YOUR_API_KEY",
    "ANTHROPIC_BASE_URL": "%s",
    "API_TIMEOUT_MS": "3000000",
    "ANTHROPIC_MODEL": "model_id",
    "AUTH_HEADER_MODE": "x-api-key"
  }
}
</pre>
<i>Use /models to get available model_id.</i>

🔧 <b>Roo Code / Continue</b>
In your config:
<pre>
{
  "apiBase": "%s/v1",
  "apiKey": "YOUR_API_KEY",
  "model": "claude-sonnet-4-5-20250929"
}
</pre>

🔧 <b>Droid</b>
Configure in settings:
<pre>
Base URL: %s
API Key: YOUR_API_KEY
Model: claude-sonnet-4-5-20250929
</pre>

📖 <b>API Endpoints:</b>

<b>OpenAI Compatible:</b>
• <code>POST /v1/chat/completions</code>
• <code>POST /v1/completions</code>
• <code>POST /v1/responses</code>
• <code>GET /v1/models</code>

<b>Anthropic Compatible:</b>
• <code>POST /v1/messages</code>
• <code>POST /v1/messages/count_tokens</code>

🧠 <b>Reasoning Effort Levels:</b>
<code>none</code> → Disabled
<code>low</code> → Light thinking (1K tokens)
<code>medium</code> → Default (8K tokens)
<code>high</code> → Deep thinking (24K tokens)
<code>xhigh</code> → Maximum (32K tokens)

Usage in model suffix: <code>model_id(high)</code>
Or in request: <code>"reasoning_effort": "high"</code>

💡 <b>Authentication:</b>
<pre>Authorization: Bearer YOUR_API_KEY</pre>

Use /models to see available model IDs.`,
		serverURL,
		serverURL,
		serverURL,
		serverURL,
		serverURL,
	)
}

func formatDuration(d time.Duration) string {
	days := int(d.Hours()) / 24
	hours := int(d.Hours()) % 24
	minutes := int(d.Minutes()) % 60

	if days > 0 {
		return fmt.Sprintf("%dd %dh %dm", days, hours, minutes)
	}
	if hours > 0 {
		return fmt.Sprintf("%dh %dm", hours, minutes)
	}
	return fmt.Sprintf("%dm", minutes)
}

func formatTokens(tokens int64) string {
	if tokens >= 1_000_000 {
		return fmt.Sprintf("%.2fM", float64(tokens)/1_000_000)
	}
	if tokens >= 1_000 {
		return fmt.Sprintf("%.1fK", float64(tokens)/1_000)
	}
	return fmt.Sprintf("%d", tokens)
}

func calculateSuccessRate(success, total int64) float64 {
	if total == 0 {
		return 100.0
	}
	return float64(success) / float64(total) * 100
}

func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

func appendUnique(slice []string, item string) []string {
	for _, s := range slice {
		if s == item {
			return slice
		}
	}
	return append(slice, item)
}
