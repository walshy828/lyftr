package utils

import (
	"errors"
	"strconv"
	"time"

	"github.com/Cawlumm/lyftr-backend/config"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type Claims struct {
	UserID int64  `json:"user_id"`
	Email  string `json:"email"`
	Type   string `json:"type"` // "access" or "refresh"
	// TokenVersion is the user's revocation epoch at issue time. Auth rejects
	// the token when it no longer matches the stored value, which is how a
	// password change kills every outstanding session in one write.
	TokenVersion int64 `json:"tv"`
	// SessionTTL is the refresh lifetime, in seconds, chosen when this session
	// began. It rides in the token because rotation mints the replacement from
	// the presented token alone — without it, the second refresh of a
	// "remember me" session would silently fall back to the global default and
	// the long session the user asked for would quietly become a short one.
	SessionTTL int64 `json:"sttl,omitempty"`
	// SessionStart is when this chain of rotations began (unix seconds).
	// Sliding expiry means an active session never lapses, so this is what
	// makes "eventually you must type your password again" true.
	SessionStart int64 `json:"sst,omitempty"`
	// SessionID identifies the device this chain belongs to, so one phone can
	// be signed out without touching the user's other devices — the gap left by
	// the existing two levers (per-jti denial, which only kills one token, and
	// token_version, which kills everything).
	SessionID string `json:"sid,omitempty"`
	// Zero values on all three mean a token minted before sessions existed; the
	// refresh path adopts those rather than rejecting them.
	jwt.RegisteredClaims
}

// Session is the device-scoped context a chain of rotating refresh tokens
// carries. Built once at login and copied forward by every refresh.
type Session struct {
	ID    string
	TTL   time.Duration
	Start time.Time
}

// NewSession starts a fresh chain. A zero or negative ttl falls back to the
// configured default so a caller can't accidentally mint an instant-expiry
// session.
func NewSession(ttl time.Duration) Session {
	if ttl <= 0 {
		ttl = RefreshTTL()
	}
	return Session{ID: uuid.NewString(), TTL: ttl, Start: time.Now()}
}

// NewSessionID mints an identifier for a device session.
func NewSessionID() string { return uuid.NewString() }

// SessionFromClaims reconstructs the session a presented refresh token belongs
// to. Tokens minted before sessions existed carry none of these claims; they
// get the configured default TTL, a start of "now", and an empty ID that the
// refresh handler adopts into a real device session.
func SessionFromClaims(c *Claims) Session {
	s := Session{ID: c.SessionID, TTL: time.Duration(c.SessionTTL) * time.Second, Start: time.Unix(c.SessionStart, 0)}
	if s.TTL <= 0 {
		s.TTL = RefreshTTL()
	}
	if c.SessionStart <= 0 {
		s.Start = time.Now()
	}
	return s
}

// PastAbsoluteCap reports whether this chain has been alive long enough that it
// must be re-established with real credentials, however active it has been.
// Sliding expiry alone would let a single login last forever.
func (s Session) PastAbsoluteCap() bool {
	return time.Since(s.Start) > AbsoluteSessionTTL()
}

// RefreshTTL is the refresh lifetime for a session the user did *not* ask to be
// remembered — a shared or one-off browser. Configurable via REFRESH_EXPIRY
// (hours); the default is deliberately short, because a refresh token is a
// bearer credential sitting in localStorage and its lifetime is the window an
// attacker gets from one theft. Users who want a long session opt into one
// explicitly (see RememberTTL), which is both safer and less annoying than
// splitting the difference for everybody.
func RefreshTTL() time.Duration {
	hours, _ := strconv.Atoi(config.C.RefreshExpiryHours)
	if hours <= 0 {
		hours = 12
	}
	return time.Duration(hours) * time.Hour
}

// RememberTTL converts a user's stored session-length preference into a
// duration, clamped to the operator's MAX_SESSION_DAYS ceiling. The clamp is
// the point: the preference arrives over an authenticated PATCH, so without a
// server-side bound a stolen access token could mint itself a decade-long
// session.
func RememberTTL(days int) time.Duration {
	maxDays := config.MaxSessionDays()
	if days <= 0 {
		days = config.DefaultSessionDays
	}
	if days > maxDays {
		days = maxDays
	}
	return time.Duration(days) * 24 * time.Hour
}

// AbsoluteSessionTTL is the hard ceiling on how long one chain of rotations may
// live, regardless of activity. Sliding expiry means a session used daily never
// expires on its own; this is what still forces a periodic real sign-in.
func AbsoluteSessionTTL() time.Duration {
	return time.Duration(config.AbsoluteSessionDays()) * 24 * time.Hour
}

// GenerateTokenPair mints an access/refresh pair for a session. The access
// token's lifetime stays global (it is the revocation granularity); only the
// refresh token's comes from the session.
func GenerateTokenPair(userID int64, email string, tokenVersion int64, sess Session) (access, refresh string, err error) {
	expiry, _ := strconv.Atoi(config.C.JWTExpiry)
	if expiry == 0 {
		expiry = 3600
	}

	access, err = generateToken(userID, email, "access", tokenVersion, time.Duration(expiry)*time.Second, sess)
	if err != nil {
		return
	}
	refresh, err = generateToken(userID, email, "refresh", tokenVersion, sess.TTL, sess)
	return
}

func generateToken(userID int64, email, tokenType string, tokenVersion int64, dur time.Duration, sess Session) (string, error) {
	claims := Claims{
		UserID:       userID,
		Email:        email,
		Type:         tokenType,
		TokenVersion: tokenVersion,
		SessionTTL:   int64(sess.TTL / time.Second),
		SessionStart: sess.Start.Unix(),
		SessionID:    sess.ID,
		RegisteredClaims: jwt.RegisteredClaims{
			// A unique ID per token so a single session can be revoked on
			// logout without touching the user's other devices.
			ID:        uuid.NewString(),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(dur)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(config.C.JWTSecret))
}

func ValidateToken(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(config.C.JWTSecret), nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}
