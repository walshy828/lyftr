// Package storage persists user-uploaded meal photos to disk. It is the
// only place in the backend that touches the filesystem outside the SQLite
// file itself, so path handling here is deliberately conservative.
package storage

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"

	"github.com/google/uuid"
)

// photoFilenamePattern matches exactly what SavePhoto generates — a UUID
// plus the .jpg extension. Callers serving a photo back should validate any
// user-supplied filename against this before touching the filesystem.
var photoFilenamePattern = regexp.MustCompile(`^[a-f0-9-]+\.jpg$`)

// SavePhoto writes jpegBytes under baseDir/{userID}/{uuid}.jpg and returns
// the path relative to baseDir (e.g. "42/abc-123.jpg").
func SavePhoto(baseDir string, userID int64, jpegBytes []byte) (string, error) {
	userDir := filepath.Join(baseDir, fmt.Sprintf("%d", userID))
	if err := os.MkdirAll(userDir, 0755); err != nil {
		return "", fmt.Errorf("create meal photo dir: %w", err)
	}

	filename := uuid.NewString() + ".jpg"
	absPath := filepath.Join(userDir, filename)
	if err := os.WriteFile(absPath, jpegBytes, 0644); err != nil {
		return "", fmt.Errorf("write meal photo: %w", err)
	}

	return filepath.Join(fmt.Sprintf("%d", userID), filename), nil
}

// DeletePhoto removes the file at baseDir/relPath. It is a no-op, not an
// error, if the file is already missing.
func DeletePhoto(baseDir, relPath string) error {
	err := os.Remove(filepath.Join(baseDir, relPath))
	if err != nil && !os.IsNotExist(err) {
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
