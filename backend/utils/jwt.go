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
	jwt.RegisteredClaims
}

// RefreshTTL is how long a refresh token stays valid. Configurable via
// REFRESH_EXPIRY (hours); the default is deliberately a week rather than the
// month it used to be — a refresh token is a bearer credential sitting in
// localStorage, so its lifetime is the window an attacker gets from one theft.
func RefreshTTL() time.Duration {
	hours, _ := strconv.Atoi(config.C.RefreshExpiryHours)
	if hours <= 0 {
		hours = 24 * 7
	}
	return time.Duration(hours) * time.Hour
}

func GenerateTokenPair(userID int64, email string, tokenVersion int64) (access, refresh string, err error) {
	expiry, _ := strconv.Atoi(config.C.JWTExpiry)
	if expiry == 0 {
		expiry = 3600
	}

	access, err = generateToken(userID, email, "access", tokenVersion, time.Duration(expiry)*time.Second)
	if err != nil {
		return
	}
	refresh, err = generateToken(userID, email, "refresh", tokenVersion, RefreshTTL())
	return
}

func generateToken(userID int64, email, tokenType string, tokenVersion int64, dur time.Duration) (string, error) {
	claims := Claims{
		UserID:       userID,
		Email:        email,
		Type:         tokenType,
		TokenVersion: tokenVersion,
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
