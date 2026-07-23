package utils

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
)

const patPrefix = "lyftr_pat_"

// GeneratePAT creates a new personal access token: plaintext is shown to the
// caller exactly once, hash is what gets stored (and compared against on every
// request), and prefix is a short cleartext fragment safe to display in a
// token list ("lyftr_pat_AbCd12...") so a user can tell tokens apart later.
func GeneratePAT() (plaintext, hash, prefix string, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", "", "", err
	}
	random := base64.RawURLEncoding.EncodeToString(b)
	plaintext = patPrefix + random
	hash = HashPAT(plaintext)
	prefix = patPrefix + random[:10]
	return plaintext, hash, prefix, nil
}

// HashPAT hashes a plaintext token for lookup/storage. SHA-256 (not bcrypt) is
// correct here: the token already carries 256 bits of entropy from
// crypto/rand, so a slow KDF adds no security value while taxing every
// PAT-authenticated request.
func HashPAT(plaintext string) string {
	sum := sha256.Sum256([]byte(plaintext))
	return hex.EncodeToString(sum[:])
}
