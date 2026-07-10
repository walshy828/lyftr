package middleware

import (
	"sync"
	"time"

	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/gin-gonic/gin"
)

// RateLimit is a fixed-capacity token bucket per client IP, meant for the
// public /auth endpoints (login/register/refresh) to blunt password
// brute-force and account enumeration. In-memory is the right scope here:
// the backend is a single process in front of a single SQLite file, so
// there's no other instance to share counters with.
func RateLimit(maxAttempts int, per time.Duration) gin.HandlerFunc {
	type bucket struct {
		tokens   float64
		lastSeen time.Time
	}
	var (
		mu      sync.Mutex
		buckets = map[string]*bucket{}
	)
	refillPerSec := float64(maxAttempts) / per.Seconds()

	return func(c *gin.Context) {
		now := time.Now()
		mu.Lock()
		// Opportunistic sweep so the map doesn't grow forever: any bucket
		// idle long enough to be full again carries no information.
		if len(buckets) > 10_000 {
			for ip, b := range buckets {
				if now.Sub(b.lastSeen) > per {
					delete(buckets, ip)
				}
			}
		}
		b, ok := buckets[c.ClientIP()]
		if !ok {
			b = &bucket{tokens: float64(maxAttempts)}
			buckets[c.ClientIP()] = b
		} else {
			b.tokens = min(float64(maxAttempts), b.tokens+now.Sub(b.lastSeen).Seconds()*refillPerSec)
		}
		b.lastSeen = now
		allowed := b.tokens >= 1
		if allowed {
			b.tokens--
		}
		mu.Unlock()

		if !allowed {
			utils.TooManyRequests(c, "too many attempts, try again shortly")
			c.Abort()
			return
		}
		c.Next()
	}
}
