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
	"github.com/router-for-me/CLIProxyAPI/v6/internal/cost"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/registry"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/usage"
	log "github.com/sirupsen/logrus"
)

// Bot represents the Telegram bot instance.
type Bot struct {
	config      config.TelegramConfig
	client      *http.Client
	startTime   time.Time
	stopCh      chan struct{}
	wg          sync.WaitGroup
	mu          sync.RWMutex
	costManager *cost.Manager
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
		client:    &http.Client{Timeout: 45 * time.Second},
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

// SetCostManager sets the cost manager reference used for quota information.
func (b *Bot) SetCostManager(manager *cost.Manager) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.costManager = manager
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
	sb.WriteString(fmt.Sprintf("👤 <b>User Usage Details</b>\n\n"))
	sb.WriteString(fmt.Sprintf("🔑 <b>API Key:</b> %s\n\n", truncateString(apiKey, 25)))

	var totalInput, totalOutput, totalReasoning, totalCached int64
	var totalCost float64
	var lastCallTime *time.Time

	type modelEntry struct {
		name      string
		requests  int64
		tokens    int64
		input     int64
		output    int64
		reasoning int64
		cached    int64
		cost      float64
		lastCall  *time.Time
	}
	var modelEntries []modelEntry

	for modelName, modelData := range apiStats.Models {
		var mInput, mOutput, mReasoning, mCached int64
		var mLastCall *time.Time

		for _, d := range modelData.Details {
			mInput += d.Tokens.InputTokens
			mOutput += d.Tokens.OutputTokens
			mReasoning += d.Tokens.ReasoningTokens
			mCached += d.Tokens.CachedTokens
			if !d.Timestamp.IsZero() {
				t := d.Timestamp
				if mLastCall == nil || t.After(*mLastCall) {
					mLastCall = &t
				}
			}
		}

		totalInput += mInput
		totalOutput += mOutput
		totalReasoning += mReasoning
		totalCached += mCached

		if mLastCall != nil && (lastCallTime == nil || mLastCall.After(*lastCallTime)) {
			lastCallTime = mLastCall
		}

		mCost := calculateModelCost(modelName, mInput, mOutput, mReasoning, mCached)
		totalCost += mCost

		modelEntries = append(modelEntries, modelEntry{
			name:      modelName,
			requests:  modelData.TotalRequests,
			tokens:    modelData.TotalTokens,
			input:     mInput,
			output:    mOutput,
			reasoning: mReasoning,
			cached:    mCached,
			cost:      mCost,
			lastCall:  mLastCall,
		})
	}

	sort.Slice(modelEntries, func(i, j int) bool {
		return modelEntries[i].requests > modelEntries[j].requests
	})

	sb.WriteString(fmt.Sprintf("📊 <b>Summary:</b>\n"))
	sb.WriteString(fmt.Sprintf("   • Total Requests: %d\n", apiStats.TotalRequests))
	sb.WriteString(fmt.Sprintf("   • Total Tokens: %s\n", formatTokens(apiStats.TotalTokens)))
	sb.WriteString(fmt.Sprintf("   • Est. Cost: $%.4f\n", totalCost))
	if lastCallTime != nil {
		sb.WriteString(fmt.Sprintf("   • Last Call: %s\n", formatRelativeTime(*lastCallTime)))
	}

	b.mu.RLock()
	cm := b.costManager
	b.mu.RUnlock()
	if cm != nil && cm.IsEnabled() {
		limits := cm.GetAllLimits()
		for _, limit := range limits {
			if limit.APIKey == apiKey {
				sb.WriteString(fmt.Sprintf("\n📈 <b>Quota Status:</b>\n"))
				if len(limit.QuotaRules) > 0 {
					for _, rule := range limit.QuotaRules {
						sb.WriteString(fmt.Sprintf("   <b>%s</b>:\n", rule.ID))
						if rule.MaxRequests > 0 {
							pct := float64(rule.CurrentRequests) / float64(rule.MaxRequests) * 100
							sb.WriteString(fmt.Sprintf("     • Requests: %d/%d (%.1f%%)\n", rule.CurrentRequests, rule.MaxRequests, pct))
						}
						if rule.MaxCost > 0 {
							pct := rule.CurrentCost / rule.MaxCost * 100
							sb.WriteString(fmt.Sprintf("     • Cost: $%.4f/$%.2f (%.1f%%)\n", rule.CurrentCost, rule.MaxCost, pct))
						}
						if rule.NextResetTime != "" {
							if t, err := time.Parse("2006-01-02T15:04:05Z07:00", rule.NextResetTime); err == nil {
								sb.WriteString(fmt.Sprintf("     • Resets: %s\n", formatTimeUntil(t)))
							}
						} else if rule.AutoResetInterval != "" && rule.AutoResetInterval != "none" {
							sb.WriteString(fmt.Sprintf("     • Interval: %s\n", rule.AutoResetInterval))
						}
					}
				} else {
					if limit.MaxRequests > 0 {
						pct := float64(limit.CurrentRequests) / float64(limit.MaxRequests) * 100
						sb.WriteString(fmt.Sprintf("   • Requests: %d/%d (%.1f%%)\n", limit.CurrentRequests, limit.MaxRequests, pct))
					}
					if limit.MaxCost > 0 {
						pct := limit.CurrentCost / limit.MaxCost * 100
						sb.WriteString(fmt.Sprintf("   • Cost: $%.4f/$%.2f (%.1f%%)\n", limit.CurrentCost, limit.MaxCost, pct))
					}
					if limit.AutoResetInterval != "" && limit.AutoResetInterval != "none" {
						nextReset := cm.GetNextResetTime(apiKey)
						if !nextReset.IsZero() {
							sb.WriteString(fmt.Sprintf("   • Resets: %s\n", formatTimeUntil(nextReset)))
						} else {
							sb.WriteString(fmt.Sprintf("   • Interval: %s\n", limit.AutoResetInterval))
						}
					}
				}
				break
			}
		}
	}

	sb.WriteString(fmt.Sprintf("\n🔢 <b>Token Breakdown:</b>\n"))
	sb.WriteString(fmt.Sprintf("   • Input: %s\n", formatTokens(totalInput)))
	sb.WriteString(fmt.Sprintf("   • Output: %s\n", formatTokens(totalOutput)))
	if totalReasoning > 0 {
		sb.WriteString(fmt.Sprintf("   • Reasoning: %s\n", formatTokens(totalReasoning)))
	}
	if totalCached > 0 {
		sb.WriteString(fmt.Sprintf("   • Cache Read: %s\n", formatTokens(totalCached)))
	}

	if len(modelEntries) > 0 {
		sb.WriteString(fmt.Sprintf("\n🤖 <b>Models (%d):</b>\n", len(modelEntries)))
		for i, m := range modelEntries {
			if i >= 10 {
				sb.WriteString(fmt.Sprintf("   <i>... and %d more</i>\n", len(modelEntries)-10))
				break
			}
			sb.WriteString(fmt.Sprintf("\n• <code>%s</code>\n", truncateString(m.name, 35)))
			sb.WriteString(fmt.Sprintf("  Reqs: %d | Tokens: %s\n", m.requests, formatTokens(m.tokens)))
			sb.WriteString(fmt.Sprintf("  In: %s | Out: %s", formatTokens(m.input), formatTokens(m.output)))
			if m.reasoning > 0 {
				sb.WriteString(fmt.Sprintf(" | Rsn: %s", formatTokens(m.reasoning)))
			}
			if m.cached > 0 {
				sb.WriteString(fmt.Sprintf(" | Cache: %s", formatTokens(m.cached)))
			}
			sb.WriteString("\n")
			sb.WriteString(fmt.Sprintf("  Cost: $%.4f", m.cost))
			if m.lastCall != nil {
				sb.WriteString(fmt.Sprintf(" | Last: %s", formatRelativeTime(*m.lastCall)))
			}
			sb.WriteString("\n")
		}
	}

	return sb.String()
}

var modelPricing = map[string]struct{ input, output, cached float64 }{
	"claude-sonnet-4-20250514":     {3.0, 15.0, 0.3},
	"claude-sonnet-4-5-20250514":   {3.0, 15.0, 0.3},
	"claude-sonnet-4-5-20250929":   {3.0, 15.0, 0.3},
	"claude-3-5-sonnet-20241022":   {3.0, 15.0, 0.3},
	"claude-3-5-haiku-20241022":    {0.80, 4.0, 0.08},
	"claude-3-opus-20240229":       {15.0, 75.0, 1.5},
	"gemini-2.5-pro":               {1.25, 10.0, 0.3125},
	"gemini-2.5-flash":             {0.15, 0.60, 0.0375},
	"gemini-2.0-flash":             {0.10, 0.40, 0.025},
	"gpt-4.1":                      {2.0, 8.0, 0.5},
	"gpt-4.1-mini":                 {0.4, 1.6, 0.1},
	"gpt-4.1-nano":                 {0.1, 0.4, 0.025},
	"gpt-4o":                       {2.5, 10.0, 1.25},
	"gpt-4o-mini":                  {0.15, 0.60, 0.075},
	"o1":                           {15.0, 60.0, 7.5},
	"o1-pro":                       {150.0, 600.0, 75.0},
	"o3":                           {10.0, 40.0, 2.5},
	"o4-mini":                      {1.10, 4.40, 0.275},
}

func calculateModelCost(modelName string, input, output, reasoning, cached int64) float64 {
	pricing, ok := modelPricing[modelName]
	if !ok {
		for prefix, p := range modelPricing {
			if strings.HasPrefix(modelName, prefix) {
				pricing = p
				ok = true
				break
			}
		}
	}
	if !ok {
		if strings.Contains(modelName, "claude") {
			pricing = struct{ input, output, cached float64 }{3.0, 15.0, 0.3}
		} else if strings.Contains(modelName, "gemini") {
			pricing = struct{ input, output, cached float64 }{0.15, 0.60, 0.0375}
		} else if strings.Contains(modelName, "gpt") || strings.Contains(modelName, "o1") || strings.Contains(modelName, "o3") || strings.Contains(modelName, "o4") {
			pricing = struct{ input, output, cached float64 }{2.0, 8.0, 0.5}
		} else {
			pricing = struct{ input, output, cached float64 }{1.0, 4.0, 0.25}
		}
	}

	nonCachedInput := input - cached
	if nonCachedInput < 0 {
		nonCachedInput = 0
	}
	inputCost := float64(nonCachedInput) / 1_000_000 * pricing.input
	outputCost := float64(output+reasoning) / 1_000_000 * pricing.output
	cachedCost := float64(cached) / 1_000_000 * pricing.cached

	return inputCost + outputCost + cachedCost
}

func formatRelativeTime(t time.Time) string {
	diff := time.Since(t)
	seconds := int(diff.Seconds())
	minutes := seconds / 60
	hours := minutes / 60
	days := hours / 24

	if days > 0 {
		return fmt.Sprintf("%dd ago", days)
	}
	if hours > 0 {
		return fmt.Sprintf("%dh ago", hours)
	}
	if minutes > 0 {
		return fmt.Sprintf("%dm ago", minutes)
	}
	return "Just now"
}

func formatTimeUntil(t time.Time) string {
	diff := time.Until(t)
	if diff <= 0 {
		return "any moment"
	}
	seconds := int(diff.Seconds())
	minutes := seconds / 60
	hours := minutes / 60
	days := hours / 24

	if days > 0 {
		if hours%24 > 0 {
			return fmt.Sprintf("in %dd %dh", days, hours%24)
		}
		return fmt.Sprintf("in %dd", days)
	}
	if hours > 0 {
		if minutes%60 > 0 {
			return fmt.Sprintf("in %dh %dm", hours, minutes%60)
		}
		return fmt.Sprintf("in %dh", hours)
	}
	if minutes > 0 {
		return fmt.Sprintf("in %dm", minutes)
	}
	return "in <1m"
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
4. Set API Key: <code>YOUR_API_KEY</code>

🔧 <b>Amp CLI</b>
Configure in <code>~/.config/amp/settings.json</code>:
<pre>
{
  "amp.url": "%s",
  "amp.apiKey": "YOUR_API_KEY"
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
