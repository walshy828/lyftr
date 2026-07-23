package utils

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
