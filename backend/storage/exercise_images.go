package storage

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sync/singleflight"
)

// Exercise movement frames, cached on local disk.
//
// The library's images live in a public GitHub repo. Serving them by URL
// straight to the browser works, but it makes every exercise view depend on
// raw.githubusercontent.com being reachable — which a phone in a basement gym
// is not — and points ~870 exercises' worth of traffic at a host that never
// agreed to serve it. Fetch once, keep the bytes.

// sourceIDPattern matches an upstream free-exercise-db slug. The value comes
// from our own exercises.source_id column rather than from a request, but it is
// still validated before being joined onto a path: a poisoned upstream sync
// must not be able to write outside the cache directory.
var sourceIDPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]+$`)

// maxImageBytes bounds what a single fetch will read. The real files are ~40 KB;
// this is only here so a redirect to something enormous can't fill the volume.
const maxImageBytes = 5 << 20

var imageFetch singleflight.Group

var imageClient = &http.Client{Timeout: 15 * time.Second}

// validateSourceID applies the same check ExerciseImagePath always has: the
// value comes from our own exercises.source_id column rather than a request,
// but a poisoned upstream sync must still not be able to write outside the
// cache directory.
func validateSourceID(sourceID string) error {
	if sourceID == "" || !sourceIDPattern.MatchString(sourceID) || strings.Contains(sourceID, "..") {
		return fmt.Errorf("invalid exercise source id")
	}
	return nil
}

// ExerciseImagePath returns the on-disk path for one frame, after validating
// both parts. The regexp permits '.', so ".." is rejected explicitly rather
// than relying on the character class.
func ExerciseImagePath(baseDir, sourceID string, frame int) (string, error) {
	if err := validateSourceID(sourceID); err != nil {
		return "", err
	}
	if frame < 0 || frame > 1 {
		return "", fmt.Errorf("invalid frame")
	}
	return filepath.Join(baseDir, sourceID, strconv.Itoa(frame)+".jpg"), nil
}

// ExerciseGifPath returns the on-disk path for an exercise's animated GIF
// (only populated for exercises seeded from config.ExerciseLibrarySource).
func ExerciseGifPath(baseDir, sourceID string) (string, error) {
	if err := validateSourceID(sourceID); err != nil {
		return "", err
	}
	return filepath.Join(baseDir, sourceID, "gif.gif"), nil
}

// EnsureExerciseImage returns the local path for a frame, downloading it on
// first request. Concurrent requests for the same frame collapse into one
// fetch: a library grid scrolling into view asks for dozens of images at once,
// and without this each would open its own connection for the same bytes.
func EnsureExerciseImage(baseDir, baseURL, sourceID string, frame int) (string, error) {
	path, err := ExerciseImagePath(baseDir, sourceID, frame)
	if err != nil {
		return "", err
	}
	if st, err := os.Stat(path); err == nil && st.Size() > 0 {
		return path, nil
	}

	_, err, _ = imageFetch.Do(path, func() (any, error) {
		// Re-check inside the flight: the winner of a race may have finished
		// between the Stat above and this call.
		if st, err := os.Stat(path); err == nil && st.Size() > 0 {
			return nil, nil
		}
		return nil, downloadExerciseImage(path, baseURL, sourceID, frame)
	})
	if err != nil {
		return "", err
	}
	return path, nil
}

// EnsureExerciseGif returns the local path for an exercise's animated GIF,
// downloading it from gifURL on first request. Unlike the two-frame photo
// pair above, the GIF dataset's layout doesn't follow a
// {baseURL}/{sourceID}/{frame}.jpg convention, so the caller passes the
// exercise's own stored gif_url rather than a base to reconstruct it from.
func EnsureExerciseGif(baseDir, sourceID, gifURL string) (string, error) {
	path, err := ExerciseGifPath(baseDir, sourceID)
	if err != nil {
		return "", err
	}
	if gifURL == "" {
		return "", fmt.Errorf("exercise has no gif_url")
	}
	if st, err := os.Stat(path); err == nil && st.Size() > 0 {
		return path, nil
	}

	_, err, _ = imageFetch.Do(path, func() (any, error) {
		if st, err := os.Stat(path); err == nil && st.Size() > 0 {
			return nil, nil
		}
		return nil, downloadExerciseMedia(path, gifURL)
	})
	if err != nil {
		return "", err
	}
	return path, nil
}

func downloadExerciseImage(path, baseURL, sourceID string, frame int) error {
	url := fmt.Sprintf("%s/%s/%d.jpg", baseURL, sourceID, frame)
	return downloadExerciseMedia(path, url)
}

// downloadExerciseMedia fetches url and writes it to path, atomically. Shared
// by the two-frame photo cache and the animated-GIF cache (EnsureExerciseGif)
// below — same size cap, same "don't cache a miss" rule, same content-type
// sniff (image/* covers both jpg and gif).
func downloadExerciseMedia(path, url string) error {
	resp, err := imageClient.Get(url)
	if err != nil {
		return fmt.Errorf("fetch exercise image: %w", err)
	}
	defer resp.Body.Close()

	// Deliberately do NOT cache a non-200 as an empty file. Upstream adds and
	// renames exercises; a 404 today may be a real image next week, and a
	// zero-byte placeholder would make that permanent.
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("exercise image %s: upstream returned %d", url, resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxImageBytes))
	if err != nil {
		return fmt.Errorf("read exercise image: %w", err)
	}
	if ct := http.DetectContentType(body); !strings.HasPrefix(ct, "image/") {
		return fmt.Errorf("exercise image %s: got %s, not an image", url, ct)
	}

	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return fmt.Errorf("create exercise image dir: %w", err)
	}

	// Write to a temp name and rename: os.Rename is atomic within a directory,
	// so a concurrent reader either sees no file or sees the whole file, never
	// a half-written one.
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return fmt.Errorf("create temp exercise image: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no-op once the rename succeeds

	if _, err := tmp.Write(body); err != nil {
		tmp.Close()
		return fmt.Errorf("write exercise image: %w", err)
	}
	if err := tmp.Chmod(0600); err != nil {
		tmp.Close()
		return fmt.Errorf("chmod exercise image: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp exercise image: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("commit exercise image: %w", err)
	}
	return nil
}
