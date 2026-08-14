package utils

// Epley1RM estimates a one-rep max from a completed set, using Epley's formula
// w * (1 + reps/30).
//
// reps == 1 returns the weight unchanged. A single rep IS the maximum that was
// actually lifted, and there is nothing to extrapolate; feeding it through the
// formula inflates a genuine measurement by 3.3% and makes a true 1RM read
// higher than the bar the lifter put back on the rack.
//
// Non-positive weight or reps return 0 rather than a number: bodyweight and
// cardio entries carry no load, so any estimate would be fiction. Callers
// distinguish "no estimate" from "a low estimate" by testing for zero.
func Epley1RM(weight float64, reps int) float64 {
	if weight <= 0 || reps <= 0 {
		return 0
	}
	if reps == 1 {
		return weight
	}
	return weight * (1 + float64(reps)/30.0)
}
