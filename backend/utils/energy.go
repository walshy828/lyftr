package utils

import (
	"math"

	"github.com/Cawlumm/lyftr-backend/models"
)

// CaloriesPerLb is the conventional energy content of a pound of body fat,
// used to convert a daily calorie deficit into a weekly rate of loss. It's an
// approximation (real-world loss tapers as the body adapts — which is why the
// AI trajectory isn't a straight line), but it's the number every published
// deficit guideline is built on, so the app reasons in the same currency.
const CaloriesPerLb = 3500

// Minimum daily intake this app will ever recommend, by sex — the same floor
// stated in the AI plan prompt, kept here so the deterministic guidance and
// the AI-generated plan can't disagree about what's safe.
const (
	CalorieFloorMale   = 1500
	CalorieFloorFemale = 1200
)

// activityLevels maps the profile's activity_level values to the standard
// Harris-Benedict activity multipliers, in ascending order. Labels are the
// everyday words for these levels ("Light", "Moderate", "Heavy") rather than
// the stored keys, since this table is shown to the user so they can see what
// their intake would need to be if they trained more or less than their
// profile says.
var activityLevels = []struct {
	Key         string
	Label       string
	Description string
	Multiplier  float64
}{
	{"sedentary", "Sedentary", "Desk job, little or no exercise", 1.2},
	{"light", "Light", "Light exercise 1-3 days/week", 1.375},
	{"moderate", "Moderate", "Moderate exercise 3-5 days/week", 1.55},
	{"active", "Heavy", "Hard exercise 6-7 days/week", 1.725},
	{"very_active", "Very heavy", "Hard daily exercise plus a physical job", 1.9},
}

// round1 rounds to one decimal — every weight and rate this file reports is a
// display value, and unrounded arithmetic output is noise.
func round1(v float64) float64 { return math.Round(v*10) / 10 }

// BMRMifflinStJeor computes resting energy expenditure with the Mifflin-St
// Jeor equation — the one most current dietetics guidance prefers over the
// older Harris-Benedict for non-athletic adults. Inputs are in the app's
// canonical imperial units and converted internally.
//
// A sex value other than "male"/"female" (an older profile row that never set
// it) uses the midpoint of the two sex constants rather than failing, so the
// user still gets a usable estimate — it's an estimate either way.
func BMRMifflinStJeor(sex string, weightLbs, heightInches float64, age int) float64 {
	if weightLbs <= 0 || heightInches <= 0 || age <= 0 {
		return 0
	}
	kg := weightLbs * 0.453592
	cm := heightInches * 2.54
	base := 10*kg + 6.25*cm - 5*float64(age)
	switch sex {
	case "male":
		return base + 5
	case "female":
		return base - 161
	default:
		return base - 78
	}
}

// CalorieFloor is the lowest daily intake this app will recommend for a given
// sex. Unknown sex takes the lower (more conservative) floor.
func CalorieFloor(sex string) int {
	if sex == "male" {
		return CalorieFloorMale
	}
	return CalorieFloorFemale
}

// BuildPlanEnergyBasis assembles the deterministic energy picture behind a
// plan: what the user's body needs at rest, what maintenance looks like at
// every activity level (not just the one on their profile — someone deciding
// whether a target is realistic wants to see what training more would buy
// them), what intake each level implies for the safe pace band, and what the
// plan's own calorie target actually works out to.
//
// None of this comes from the AI. It's computed here so the numbers the user
// makes a decision on are reproducible, unit-tested, and identical every time
// the same profile generates a plan — the AI's contribution is the shaped
// trajectory and the write-up, not the arithmetic.
//
// calorieTarget is the plan's proposed daily intake; pass 0 when there isn't
// one yet and the plan-relative fields are simply left at zero.
func BuildPlanEnergyBasis(profile models.UserProfile, age int, currentWeightLbs, targetWeightLbs float64, calorieTarget int, guidance models.WeeklyLossGuidance) models.PlanEnergyBasis {
	bmi := BMI(currentWeightLbs, profile.HeightInches)
	floor := CalorieFloor(profile.Sex)
	bmr := BMRMifflinStJeor(profile.Sex, currentWeightLbs, profile.HeightInches, age)

	basis := models.PlanEnergyBasis{
		Sex:              profile.Sex,
		Age:              age,
		HeightInches:     profile.HeightInches,
		CurrentWeightLbs: round1(currentWeightLbs),
		TargetWeightLbs:  round1(targetWeightLbs),
		WeightToLoseLbs:  round1(currentWeightLbs - targetWeightLbs),
		BMI:              math.Round(bmi*10) / 10,
		BMICategory:      BMICategory(bmi),
		BMR:              int(math.Round(bmr)),
		ActivityLevel:    profile.ActivityLevel,
		CalorieFloor:     floor,
		CalorieTarget:    calorieTarget,
		Guidance:         guidance,
	}

	for _, l := range activityLevels {
		maintenance := int(math.Round(bmr * l.Multiplier))
		level := models.ActivityEnergyLevel{
			Key:                 l.Key,
			Label:               l.Label,
			Description:         l.Description,
			Multiplier:          l.Multiplier,
			MaintenanceCalories: maintenance,
			IsProfileLevel:      l.Key == profile.ActivityLevel,
		}
		// The recommended window runs from the faster end of the safe pace
		// band (the bigger deficit, so the *lower* intake) to the slower end.
		// Clamping at the floor is what makes an aggressive pace visibly
		// unreachable by diet alone at a low activity level, instead of
		// silently recommending an unsafe intake.
		level.IntakeLowCalories = maintenance - int(math.Round(guidance.HighLbsPerWeek*CaloriesPerLb/7))
		level.IntakeHighCalories = maintenance - int(math.Round(guidance.LowLbsPerWeek*CaloriesPerLb/7))
		if level.IntakeLowCalories < floor {
			level.IntakeLowCalories = floor
			level.FloorLimited = true
		}
		if level.IntakeHighCalories < floor {
			level.IntakeHighCalories = floor
			level.FloorLimited = true
		}
		if calorieTarget > 0 {
			level.PlanDeficitCalories = maintenance - calorieTarget
			level.PlanLbsPerWeek = round1(float64(level.PlanDeficitCalories) * 7 / CaloriesPerLb)
		}
		basis.Levels = append(basis.Levels, level)
		if level.IsProfileLevel {
			basis.MaintenanceCalories = level.MaintenanceCalories
			basis.PlanDeficitCalories = level.PlanDeficitCalories
			basis.PlanLbsPerWeek = level.PlanLbsPerWeek
		}
	}

	basis.Protein, basis.Fat = MacroRangesFor(targetWeightLbs, calorieTarget)
	return basis
}

// MacroRangesFor derives the protein and fat bands a deficit plan should sit
// in. Both scale with *goal* weight, not current weight: protein needs track
// the body you're maintaining, and pricing them off a high starting weight
// would recommend far more than the evidence supports for someone with a lot
// to lose.
//
// Protein 0.8-1.0 g/lb is the range commonly cited for preserving lean mass
// in a calorie deficit; fat 0.3-0.4 g/lb covers essential fatty acids and
// hormone production. The fat floor is additionally held at 20% of the
// calorie target, since a very low-calorie plan can make the g/lb figure fall
// below what's sensible as a share of intake. Carbohydrate is deliberately
// not given a band — it's the remainder once protein and fat are set, and the
// client computes it from whatever calorie target the user settles on.
func MacroRangesFor(targetWeightLbs float64, calorieTarget int) (protein, fat models.MacroRange) {
	if targetWeightLbs <= 0 {
		return protein, fat
	}
	protein = models.MacroRange{
		LowGrams:   int(math.Round(targetWeightLbs * 0.8)),
		HighGrams:  int(math.Round(targetWeightLbs * 1.0)),
		PerLbLow:   0.8,
		PerLbHigh:  1.0,
		Basis:      "goal weight",
		Rationale:  "Protects lean muscle while you're in a calorie deficit, and keeps you fuller between meals.",
		FloorGrams: int(math.Round(targetWeightLbs * 0.6)),
	}
	fat = models.MacroRange{
		LowGrams:  int(math.Round(targetWeightLbs * 0.3)),
		HighGrams: int(math.Round(targetWeightLbs * 0.4)),
		PerLbLow:  0.3,
		PerLbHigh: 0.4,
		Basis:     "goal weight",
		Rationale: "Enough for hormone production and absorbing fat-soluble vitamins; the rest of your calories go to carbs.",
	}
	if calorieTarget > 0 {
		if min20pct := int(math.Round(float64(calorieTarget) * 0.20 / 9)); fat.LowGrams < min20pct {
			fat.LowGrams = min20pct
		}
		if fat.HighGrams < fat.LowGrams {
			fat.HighGrams = fat.LowGrams
		}
	}
	fat.FloorGrams = fat.LowGrams
	return protein, fat
}
