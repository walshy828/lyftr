// Package storage persists user-uploaded meal photos to disk. It is the
// only place in the backend that touches the filesystem outside the SQLite
// file itself, so path handling here is deliberately conservative.
package storage

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/google/uuid"
)

// photoFilenamePattern matches exactly what SavePhoto generates — a UUID
// plus the .jpg extension. Callers serving a photo back should validate any
// user-supplied filename against this before touching the filesystem.
var photoFilenamePattern = regexp.MustCompile(`^[a-f0-9-]+\.jpg$`)

// SavePhoto writes jpegBytes under baseDir/{userID}/{uuid}.jpg and returns
// the path relative to baseDir (e.g. "42/abc-123.jpg").
func SavePhoto(baseDir string, userID int64, jpegBytes []byte) (string, error) {
	// 0700/0600 below: meal photos are personal data sitting next to the
	// database on the same volume, and nothing outside this process reads them
	// — they are served back through an authenticated handler, not by nginx.
	userDir := filepath.Join(baseDir, fmt.Sprintf("%d", userID))
	if err := os.MkdirAll(userDir, 0700); err != nil {
		return "", fmt.Errorf("create meal photo dir: %w", err)
	}

	filename := uuid.NewString() + ".jpg"
	absPath := filepath.Join(userDir, filename)
	if err := os.WriteFile(absPath, jpegBytes, 0600); err != nil {
		return "", fmt.Errorf("write meal photo: %w", err)
	}

	return filepath.Join(fmt.Sprintf("%d", userID), filename), nil
}

// DeleteUserPhoto removes the photo at the "{userID}/{filename}" relative path
// produced by SavePhoto, but only if it really belongs to userID. relPath comes
// from a FoodLog.ImageURL, which is a client-supplied string, so it is resolved
// through AbsPath rather than joined directly — an unvalidated join here would
// let "../../lyftr.db" unlink an arbitrary file, and a mismatched leading
// segment would let one user delete another's photo. It is a no-op, not an
// error, if the file is already missing.
func DeleteUserPhoto(baseDir string, userID int64, relPath string) error {
	owner, filename, ok := strings.Cut(relPath, "/")
	if !ok || owner != fmt.Sprintf("%d", userID) {
		return fmt.Errorf("photo does not belong to user %d", userID)
	}

	absPath, err := AbsPath(baseDir, userID, filename)
	if err != nil {
		return err
	}

	if err := os.Remove(absPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("delete meal photo: %w", err)
	}
	return nil
}

// AbsPath returns the filesystem path for a userID/filename pair, after
// validating the filename against photoFilenamePattern to foreclose path
// traversal — the filename must look exactly like something SavePhoto
// generated.
func AbsPath(baseDir string, userID int64, filename string) (string, error) {
	if !photoFilenamePattern.MatchString(filename) {
		return "", fmt.Errorf("invalid photo filename")
	}
	return filepath.Join(baseDir, fmt.Sprintf("%d", userID), filename), nil
}
