package config

// defaultKiroAliases returns the default oauth-model-alias configuration
// for the kiro channel. Maps kiro-prefixed model names to standard Claude model
// names so that clients like Claude Code can use standard names directly.
func defaultKiroAliases() []OAuthModelAlias {
	return []OAuthModelAlias{
		// Sonnet 4.6
		{Name: "kiro-claude-sonnet-4-6", Alias: "claude-sonnet-4-6", Fork: true},
		// Sonnet 4.5
		{Name: "kiro-claude-sonnet-4-5", Alias: "claude-sonnet-4-5-20250929", Fork: true},
		{Name: "kiro-claude-sonnet-4-5", Alias: "claude-sonnet-4-5", Fork: true},
		// Sonnet 4
		{Name: "kiro-claude-sonnet-4", Alias: "claude-sonnet-4-20250514", Fork: true},
		{Name: "kiro-claude-sonnet-4", Alias: "claude-sonnet-4", Fork: true},
		// Opus 4.6
		{Name: "kiro-claude-opus-4-6", Alias: "claude-opus-4-6", Fork: true},
		// Opus 4.5
		{Name: "kiro-claude-opus-4-5", Alias: "claude-opus-4-5-20251101", Fork: true},
		{Name: "kiro-claude-opus-4-5", Alias: "claude-opus-4-5", Fork: true},
		// Haiku 4.5
		{Name: "kiro-claude-haiku-4-5", Alias: "claude-haiku-4-5-20251001", Fork: true},
		{Name: "kiro-claude-haiku-4-5", Alias: "claude-haiku-4-5", Fork: true},
	}
}

// defaultGitHubCopilotAliases returns default oauth-model-alias entries that
// expose Claude hyphen-style IDs for GitHub Copilot Claude models.
// This keeps compatibility with clients (e.g. Claude Code) that use
// Anthropic-style model IDs like "claude-opus-4-6".
func defaultGitHubCopilotAliases() []OAuthModelAlias {
	return []OAuthModelAlias{
		{Name: "claude-haiku-4.5", Alias: "claude-haiku-4-5", Fork: true},
		{Name: "claude-opus-4.1", Alias: "claude-opus-4-1", Fork: true},
		{Name: "claude-opus-4.5", Alias: "claude-opus-4-5", Fork: true},
		{Name: "claude-opus-4.6", Alias: "claude-opus-4-6", Fork: true},
		{Name: "claude-sonnet-4.5", Alias: "claude-sonnet-4-5", Fork: true},
		{Name: "claude-sonnet-4.6", Alias: "claude-sonnet-4-6", Fork: true},
	}
}
