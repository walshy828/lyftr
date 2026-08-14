package storage

import (
	"path/filepath"
	"strings"
	"testing"
)

// The source id is joined onto a filesystem path, so it is validated even
// though it comes from our own table rather than from a request — a poisoned
// upstream sync must not be able to write outside the cache directory.
func TestExerciseImagePath_rejectsUnsafeSourceIDs(t *testing.T) {
	base := "/var/lib/lyftr/exercise-images"

	bad := []struct{ name, id string }{
		{"empty", ""},
		{"parent traversal", "../../etc"},
		{"embedded traversal", "Barbell/../../../etc"},
		// The pattern permits '.', so "..'" has to be rejected explicitly
		// rather than by the character class.
		{"bare dotdot", ".."},
		{"absolute path", "/etc/passwd"},
		{"separator", "Barbell/Bench"},
		{"null byte", "Barbell\x00"},
		{"space", "Barbell Bench"},
		{"shell metachar", "Barbell;rm"},
	}
	for _, tc := range bad {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := ExerciseImagePath(base, tc.id, 0); err == nil {
				t.Errorf("expected %q to be rejected", tc.id)
			}
		})
	}
}

func TestExerciseImagePath_acceptsRealSlugs(t *testing.T) {
	base := "/var/lib/lyftr/exercise-images"

	// Real slugs from the upstream dataset.
	for _, id := range []string{
		"Barbell_Bench_Press_-_Medium_Grip",
		"3_4_Sit-Up",
		"Ab_Roller",
		"Zottman_Curl",
	} {
		path, err := ExerciseImagePath(base, id, 0)
		if err != nil {
			t.Fatalf("%q rejected: %v", id, err)
		}
		if !strings.HasPrefix(filepath.Clean(path), base+string(filepath.Separator)) {
			t.Errorf("%q resolved outside the cache dir: %s", id, path)
		}
	}
}

// Only the two frames the dataset ships exist; anything else is a probe.
func TestExerciseImagePath_boundsFrame(t *testing.T) {
	base := "/tmp/cache"
	for _, frame := range []int{0, 1} {
		if _, err := ExerciseImagePath(base, "Ab_Roller", frame); err != nil {
			t.Errorf("frame %d should be valid: %v", frame, err)
		}
	}
	for _, frame := range []int{-1, 2, 99} {
		if _, err := ExerciseImagePath(base, "Ab_Roller", frame); err == nil {
			t.Errorf("frame %d should be rejected", frame)
		}
	}
}

func TestExerciseImagePath_layout(t *testing.T) {
	got, err := ExerciseImagePath("/cache", "Ab_Roller", 1)
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join("/cache", "Ab_Roller", "1.jpg")
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}
