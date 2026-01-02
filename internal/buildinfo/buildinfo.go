// Package buildinfo exposes compile-time metadata shared across the server.
package buildinfo

import "time"

// The following variables are overridden via ldflags during release builds.
// Defaults cover local development builds.
var (
	// Version is the semantic version or git describe output of the binary.
	Version = "dev"

	// Commit is the git commit SHA baked into the binary.
	Commit = "none"

	// BuildDate records when the binary was built in UTC.
	BuildDate = "unknown"

	// ServerStartTime is set when the server starts and used to calculate uptime.
	ServerStartTime = time.Now()
)
