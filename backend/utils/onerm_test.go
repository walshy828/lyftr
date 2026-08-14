package utils

import (
	"math"
	"testing"
)

func TestEpley1RM(t *testing.T) {
	cases := []struct {
		name   string
		weight float64
		reps   int
		want   float64
	}{
		// A single rep is a measurement, not an estimate. Raw Epley would
		// return 103.33 here and report a lift heavier than the one performed.
		{"single rep is the max itself", 100, 1, 100},
		{"five reps", 100, 5, 100 * (1 + 5.0/30.0)},
		{"ten reps", 225, 10, 225 * (1 + 10.0/30.0)},
		// Bodyweight and cardio sets carry no load; an estimate would be fiction.
		{"zero weight has no estimate", 0, 10, 0},
		{"zero reps has no estimate", 100, 0, 0},
		{"negative weight has no estimate", -5, 5, 0},
		{"negative reps has no estimate", 100, -1, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Epley1RM(tc.weight, tc.reps)
			if math.Abs(got-tc.want) > 1e-9 {
				t.Errorf("Epley1RM(%v, %d) = %v, want %v", tc.weight, tc.reps, got, tc.want)
			}
		})
	}
}

// More reps at the same weight must estimate a higher max, and more weight at
// the same reps likewise — the property the progress chart actually relies on.
func TestEpley1RM_monotonic(t *testing.T) {
	prev := Epley1RM(100, 1)
	for reps := 2; reps <= 20; reps++ {
		got := Epley1RM(100, reps)
		if got <= prev {
			t.Fatalf("expected e1RM to rise with reps: %d reps gave %v, previous %v", reps, got, prev)
		}
		prev = got
	}
	if Epley1RM(150, 5) <= Epley1RM(100, 5) {
		t.Error("expected e1RM to rise with weight at equal reps")
	}
}
