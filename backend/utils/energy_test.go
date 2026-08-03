package utils

import (
	"testing"

	"github.com/Cawlumm/lyftr-backend/models"
)

func TestBMRMifflinStJeor(t *testing.T) {
	// 40yo male, 70in, 230lbs -> 10*104.3 + 6.25*177.8 - 5*40 + 5 = ~1959
	if got := BMRMifflinStJeor("male", 230, 70, 40); got < 1940 || got > 1980 {
		t.Errorf("male BMR = %v, want ~1959", got)
	}
	// Same body, female: 166 kcal lower (the +5 vs -161 sex constant).
	male := BMRMifflinStJeor("male", 230, 70, 40)
	female := BMRMifflinStJeor("female", 230, 70, 40)
	if diff := male - female; diff < 165.9 || diff > 166.1 {
		t.Errorf("male - female BMR = %v, want 166", diff)
	}
	// Unset sex sits between the two rather than failing.
	unset := BMRMifflinStJeor("", 230, 70, 40)
	if unset >= male || unset <= female {
		t.Errorf("unset-sex BMR = %v, want between %v and %v", unset, female, male)
	}
	for _, args := range [][3]float64{{0, 70, 40}, {230, 0, 40}, {230, 70, 0}} {
		if got := BMRMifflinStJeor("male", args[0], args[1], int(args[2])); got != 0 {
			t.Errorf("BMRMifflinStJeor with a zero input = %v, want 0", got)
		}
	}
}

func TestCalorieFloor(t *testing.T) {
	if got := CalorieFloor("male"); got != CalorieFloorMale {
		t.Errorf("male floor = %d, want %d", got, CalorieFloorMale)
	}
	// Female and unknown both take the lower, more conservative floor.
	for _, sex := range []string{"female", ""} {
		if got := CalorieFloor(sex); got != CalorieFloorFemale {
			t.Errorf("CalorieFloor(%q) = %d, want %d", sex, got, CalorieFloorFemale)
		}
	}
}

func basisProfile() models.UserProfile {
	return models.UserProfile{Sex: "male", HeightInches: 70, ActivityLevel: "moderate"}
}

func TestBuildPlanEnergyBasis_recountsProfileAndLevels(t *testing.T) {
	guidance := WeeklyLossGuidanceFor("obese", 230)
	b := BuildPlanEnergyBasis(basisProfile(), 40, 230, 180, 1900, guidance)

	if b.Sex != "male" || b.HeightInches != 70 || b.CurrentWeightLbs != 230 || b.TargetWeightLbs != 180 {
		t.Errorf("profile recount = %+v, want the inputs echoed back", b)
	}
	if b.WeightToLoseLbs != 50 {
		t.Errorf("WeightToLoseLbs = %v, want 50", b.WeightToLoseLbs)
	}
	if b.BMICategory != "obese" {
		t.Errorf("BMICategory = %q, want obese", b.BMICategory)
	}
	if len(b.Levels) != 5 {
		t.Fatalf("got %d levels, want 5 (sedentary..very_active)", len(b.Levels))
	}
	// Maintenance must rise monotonically with activity, and the profile's own
	// level must be the one lifted into the headline fields.
	profileLevels := 0
	for i, l := range b.Levels {
		if l.MaintenanceCalories <= b.BMR {
			t.Errorf("level %q maintenance %d, want above BMR %d", l.Key, l.MaintenanceCalories, b.BMR)
		}
		if i > 0 && l.MaintenanceCalories <= b.Levels[i-1].MaintenanceCalories {
			t.Errorf("level %q maintenance %d not above %q", l.Key, l.MaintenanceCalories, b.Levels[i-1].Key)
		}
		if l.IsProfileLevel {
			profileLevels++
			if b.MaintenanceCalories != l.MaintenanceCalories || b.PlanDeficitCalories != l.PlanDeficitCalories {
				t.Errorf("headline fields don't match the profile level %q", l.Key)
			}
		}
	}
	if profileLevels != 1 {
		t.Errorf("got %d levels flagged as the profile's, want exactly 1", profileLevels)
	}
}

func TestBuildPlanEnergyBasis_deficitMatchesPace(t *testing.T) {
	guidance := WeeklyLossGuidanceFor("obese", 230)
	b := BuildPlanEnergyBasis(basisProfile(), 40, 230, 180, 1900, guidance)

	for _, l := range b.Levels {
		wantDeficit := l.MaintenanceCalories - 1900
		if l.PlanDeficitCalories != wantDeficit {
			t.Errorf("%s deficit = %d, want %d", l.Key, l.PlanDeficitCalories, wantDeficit)
		}
		wantPace := float64(wantDeficit) * 7 / CaloriesPerLb
		if diff := l.PlanLbsPerWeek - wantPace; diff > 0.06 || diff < -0.06 {
			t.Errorf("%s pace = %v, want ~%v", l.Key, l.PlanLbsPerWeek, wantPace)
		}
		// A faster pace means a bigger deficit, so the low end of the
		// recommended intake window is the lower calorie figure.
		if l.IntakeLowCalories > l.IntakeHighCalories {
			t.Errorf("%s intake window inverted: %d-%d", l.Key, l.IntakeLowCalories, l.IntakeHighCalories)
		}
	}
}

func TestBuildPlanEnergyBasis_clampsIntakeToFloor(t *testing.T) {
	// A small, older, sedentary woman on the obese pace band: the deficit the
	// band asks for would push intake under the floor, which must be clamped
	// and flagged rather than recommended.
	profile := models.UserProfile{Sex: "female", HeightInches: 60, ActivityLevel: "sedentary"}
	guidance := WeeklyLossGuidanceFor("obese", 200)
	b := BuildPlanEnergyBasis(profile, 65, 200, 140, 1300, guidance)

	sedentary := b.Levels[0]
	if sedentary.Key != "sedentary" {
		t.Fatalf("first level = %q, want sedentary", sedentary.Key)
	}
	if sedentary.IntakeLowCalories < b.CalorieFloor {
		t.Errorf("intake %d below floor %d", sedentary.IntakeLowCalories, b.CalorieFloor)
	}
	if !sedentary.FloorLimited {
		t.Errorf("sedentary level should be flagged FloorLimited, got %+v", sedentary)
	}
}

func TestBuildPlanEnergyBasis_noCalorieTarget(t *testing.T) {
	b := BuildPlanEnergyBasis(basisProfile(), 40, 230, 180, 0, WeeklyLossGuidanceFor("obese", 230))
	if b.PlanDeficitCalories != 0 || b.PlanLbsPerWeek != 0 {
		t.Errorf("plan-relative fields = %d/%v, want zero without a calorie target", b.PlanDeficitCalories, b.PlanLbsPerWeek)
	}
	// Maintenance and the macro bands don't depend on the target and must
	// still be populated.
	if b.MaintenanceCalories == 0 || b.Protein.LowGrams == 0 {
		t.Errorf("basis = %+v, want maintenance and macro bands regardless", b)
	}
}

func TestMacroRangesFor(t *testing.T) {
	protein, fat := MacroRangesFor(180, 2000)
	if protein.LowGrams != 144 || protein.HighGrams != 180 {
		t.Errorf("protein = %d-%dg, want 144-180 (0.8-1.0 g/lb of 180)", protein.LowGrams, protein.HighGrams)
	}
	if protein.FloorGrams != 108 {
		t.Errorf("protein floor = %dg, want 108 (0.6 g/lb)", protein.FloorGrams)
	}
	// 0.3-0.4 g/lb = 54-72g; 20% of 2000 kcal is only 44g, so g/lb wins here.
	if fat.LowGrams != 54 || fat.HighGrams != 72 {
		t.Errorf("fat = %d-%dg, want 54-72", fat.LowGrams, fat.HighGrams)
	}

	// A light person on a high calorie target: 20% of calories exceeds the
	// g/lb figure and becomes the binding fat minimum.
	_, fatHighCal := MacroRangesFor(120, 3000)
	if want := 67; fatHighCal.LowGrams != want {
		t.Errorf("fat low = %dg, want %dg (20%% of 3000 kcal)", fatHighCal.LowGrams, want)
	}
	if fatHighCal.HighGrams < fatHighCal.LowGrams {
		t.Errorf("fat band inverted: %d-%d", fatHighCal.LowGrams, fatHighCal.HighGrams)
	}

	if p, f := MacroRangesFor(0, 2000); p.LowGrams != 0 || f.LowGrams != 0 {
		t.Errorf("zero goal weight = %+v/%+v, want empty ranges", p, f)
	}
}
