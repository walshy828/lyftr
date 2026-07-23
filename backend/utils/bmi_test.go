package utils

import "testing"

func TestBMI(t *testing.T) {
	// 5'10" (70in), 230lbs -> ~33.0
	if got := BMI(230, 70); got < 32.9 || got > 33.1 {
		t.Errorf("BMI(230, 70) = %v, want ~33.0", got)
	}
	if got := BMI(150, 0); got != 0 {
		t.Errorf("BMI with zero height = %v, want 0", got)
	}
}

func TestBMICategory(t *testing.T) {
	cases := map[float64]string{
		0:  "unknown",
		17: "underweight",
		22: "healthy",
		27: "overweight",
		33: "obese",
	}
	for bmi, want := range cases {
		if got := BMICategory(bmi); got != want {
			t.Errorf("BMICategory(%v) = %q, want %q", bmi, got, want)
		}
	}
}

func TestHealthyWeightRangeLbs(t *testing.T) {
	low, high := HealthyWeightRangeLbs(70)
	if low <= 0 || high <= low {
		t.Fatalf("HealthyWeightRangeLbs(70) = (%v, %v), want positive increasing range", low, high)
	}
	// Sanity: healthy BMI range for 70in is roughly 129-174 lbs.
	if low < 125 || low > 135 {
		t.Errorf("low = %v, want ~129", low)
	}
	if high < 170 || high > 180 {
		t.Errorf("high = %v, want ~174", high)
	}
	if l, h := HealthyWeightRangeLbs(0); l != 0 || h != 0 {
		t.Errorf("HealthyWeightRangeLbs(0) = (%v, %v), want (0, 0)", l, h)
	}
}
