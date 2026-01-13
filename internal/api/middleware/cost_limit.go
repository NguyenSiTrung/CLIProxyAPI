// Package middleware provides HTTP middleware components for the CLI Proxy API server.
// This file contains the cost limit enforcement middleware that blocks requests
// when an API key has exceeded its configured cost limit.
package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/cost"
)

// CostLimitMiddleware creates a Gin middleware that enforces cost limits per API key.
// It checks the accumulated cost against the configured limit and returns HTTP 429
// (Too Many Requests) when the limit is exceeded.
//
// This middleware should be registered AFTER the auth middleware so that the
// API key is available in the request context.
func CostLimitMiddleware(manager *cost.Manager) gin.HandlerFunc {
	return func(c *gin.Context) {
		if manager == nil || !manager.IsEnabled() {
			c.Next()
			return
		}

		apiKey, exists := c.Get("apiKey")
		if !exists {
			c.Next()
			return
		}

		apiKeyStr, ok := apiKey.(string)
		if !ok || apiKeyStr == "" {
			c.Next()
			return
		}

		allowed, current, limit, exceeded := manager.CheckLimit(apiKeyStr)
		if !allowed {
			var errorMsg, errorCode string
			switch exceeded {
			case cost.LimitCost:
				errorCode = "cost_limit_exceeded"
				errorMsg = "API key has exceeded its cost limit. Contact administrator to reset."
			case cost.LimitRequest:
				errorCode = "request_limit_exceeded"
				errorMsg = "API key has exceeded its request count limit. Contact administrator to reset."
			default:
				errorCode = "limit_exceeded"
				errorMsg = "API key has exceeded its limit. Contact administrator to reset."
			}
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error":        errorCode,
				"message":      errorMsg,
				"limit_type":   string(exceeded),
				"current_cost": current,
				"max_cost":     limit,
				"currency":     "USD",
				"api_key":      maskAPIKey(apiKeyStr),
			})
			return
		}

		c.Next()
	}
}

// maskAPIKey returns a masked version of the API key showing only the last 4 characters.
func maskAPIKey(apiKey string) string {
	if len(apiKey) <= 4 {
		return "****"
	}
	return "****" + apiKey[len(apiKey)-4:]
}
