package utils

import "github.com/Cawlumm/lyftr-backend/models"

// WeeklyLossGuidanceFor derives a safe weekly-loss range from BMI category
// and current body weight — heavier/higher-BMI starting points can safely
// sustain a faster percentage-of-bodyweight loss than someone near a healthy
// weight, which is why this scales with weightLbs rather than being a flat
// number for everyone. Absolute rates are capped for safety regardless of
// body weight (2 lbs/week is the generally-cited upper safe bound). This is
// the guidance surfaced to the user on their profile/plan page and fed into
// the AI plan-generation prompt as the target steady-state rate, rather than
// a single one-size-fits-all cap.
func WeeklyLossGuidanceFor(category string, weightLbs float64) models.WeeklyLossGuidance {
	switch category {
	case "obese":
		return models.WeeklyLossGuidance{
			LowLbsPerWeek:  clamp(weightLbs*0.005, 1, 2),
			HighLbsPerWeek: clamp(weightLbs*0.01, 1.5, 2),
			Note:           "At your BMI, a pace of about 1-2 lbs/week is generally considered safe, often faster in the first couple of weeks (mostly water weight) before settling into a steadier rate.",
		}
	case "overweight":
		return models.WeeklyLossGuidance{
			LowLbsPerWeek:  clamp(weightLbs*0.004, 0.75, 1.25),
			HighLbsPerWeek: clamp(weightLbs*0.0075, 1, 1.5),
			Note:           "At your BMI, about 1-1.5 lbs/week is a sustainable pace — faster loss tends to come back quickly once it's mostly water weight.",
		}
	case "healthy":
		return models.WeeklyLossGuidance{
			LowLbsPerWeek:  clamp(weightLbs*0.002, 0.25, 0.5),
			HighLbsPerWeek: clamp(weightLbs*0.005, 0.5, 1),
			Note:           "You're already in a healthy BMI range. If you still want to trim down, a slow pace under 1 lb/week is safer and easier to hold onto — there's less to safely lose.",
		}
	default: // "underweight" or "unknown"
		return models.WeeklyLossGuidance{
			Note: "Your BMI is already at or below the healthy range — further weight loss generally isn't recommended. Consider talking to a healthcare provider before pursuing a weight-loss plan.",
		}
	}
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// BMI computes standard Body Mass Index from weight in pounds and height in
// inches: 703 * lbs / in².
func BMI(weightLbs, heightInches float64) float64 {
	if heightInches <= 0 {
		return 0
	}
	return 703 * weightLbs / (heightInches * heightInches)
}

// BMICategory maps a BMI value to the standard CDC/WHO adult categories.
func BMICategory(bmi float64) string {
	switch {
	case bmi <= 0:
		return "unknown"
	case bmi < 18.5:
		return "underweight"
	case bmi < 25:
		return "healthy"
	case bmi < 30:
		return "overweight"
	default:
		return "obese"
	}
}

// HealthyWeightRangeLbs solves the BMI formula for weight at the standard
// healthy-BMI bounds (18.5–24.9), returning the healthy weight range in
// pounds for a given height.
func HealthyWeightRangeLbs(heightInches float64) (low, high float64) {
	if heightInches <= 0 {
		return 0, 0
	}
	sq := heightInches * heightInches
	low = 18.5 * sq / 703
	high = 24.9 * sq / 703
	return low, high
}
