package middleware

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/ratelimit"
)

// RateLimitMiddleware creates a Gin middleware that enforces request rate limiting.
// It queues requests per access key and processes them with a minimum interval.
//
// This middleware should be registered AFTER the auth and cost limit middlewares
// so that quota checks occur before queuing.
func RateLimitMiddleware(manager *ratelimit.Manager) gin.HandlerFunc {
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

		item, err := manager.Enqueue(c.Request.Context(), apiKeyStr)
		if err != nil {
			if errors.Is(err, ratelimit.ErrQueueFull) {
				c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
					"error":   "rate_limit_queue_full",
					"message": "Too many pending requests. Please try again later.",
					"api_key": maskAPIKey(apiKeyStr),
				})
				return
			}
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
				"error":   "rate_limit_error",
				"message": "Rate limiter error.",
			})
			return
		}

		select {
		case <-item.Done:
		case <-c.Request.Context().Done():
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error":   "rate_limit_timeout",
				"message": "Request timed out waiting in rate limit queue.",
				"api_key": maskAPIKey(apiKeyStr),
			})
			return
		}

		if !item.Proceed {
			if item.Error != nil {
				if errors.Is(item.Error, context.DeadlineExceeded) || errors.Is(item.Error, context.Canceled) {
					c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
						"error":   "rate_limit_timeout",
						"message": "Request timed out waiting in rate limit queue.",
						"api_key": maskAPIKey(apiKeyStr),
					})
					return
				}
				if errors.Is(item.Error, ratelimit.ErrWorkerStopped) {
					c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
						"error":   "service_unavailable",
						"message": "Rate limiter is shutting down. Please retry.",
					})
					return
				}
			}
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error":   "rate_limit_error",
				"message": "Rate limit processing error.",
				"api_key": maskAPIKey(apiKeyStr),
			})
			return
		}

		c.Next()
	}
}
