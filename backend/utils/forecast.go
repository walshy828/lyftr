package utils

import (
	"math"
	"sort"
	"time"

	"github.com/Cawlumm/lyftr-backend/models"
)

const (
	// forecastMinDays is the minimum number of distinct calendar days (spanning
	// at least that many elapsed days) required before a trend is fit at all —
	// 2 points always fit a line with zero residual, which is false precision.
	forecastMinDays = 3
	// forecastLookbackDays bounds how far back the trend line looks: long
	// enough to smooth over a bad week, short enough to react if the user's
	// real rate has genuinely changed.
	forecastLookbackDays = 28
	// forecastMaxPoints caps how many weekly points a forecast emits.
	forecastMaxPoints = 12
	// forecastFallbackMaxLbsPerWeek is the clamp used when no plan-specific
	// guidance is available (e.g. unknown BMI category).
	forecastFallbackMaxLbsPerWeek = 2.0
)

// ForecastActualWeight fits a clamped linear trend to recent daily weight
// logs and projects it forward to horizonEnd, so the "Actual Forecast" chart
// line shows where the user's real trend is headed without one noisy swing
// day distorting the projection. The fitted slope is clamped to the user's
// own safe-pace guidance (or a 2 lbs/week fallback) so a single big-swing
// week can't push the forecast past a physiologically sane rate — that
// clamp is what keeps this from over-predicting relative to the plan.
//
// Returns nil if there isn't enough data to fit a trend, or if horizonEnd
// isn't in the future relative to the most recent log — callers should treat
// a nil/empty result as "no forecast line to draw" rather than an error.
func ForecastActualWeight(logs []models.WeightLog, guidance models.WeeklyLossGuidance, horizonEnd time.Time) []models.WeightPlanProjectionPoint {
	daily := dailyWeights(logs)
	if len(daily) < forecastMinDays {
		return nil
	}
	if daily[len(daily)-1].day.Sub(daily[0].day) < time.Duration(forecastMinDays-1)*24*time.Hour {
		return nil
	}
	if len(daily) > forecastLookbackDays {
		daily = daily[len(daily)-forecastLookbackDays:]
	}

	slope := olsSlopePerDay(daily) // lbs/day

	maxPerWeek := guidance.HighLbsPerWeek
	if maxPerWeek < forecastFallbackMaxLbsPerWeek {
		maxPerWeek = forecastFallbackMaxLbsPerWeek
	}
	maxPerDay := maxPerWeek / 7
	if slope > maxPerDay {
		slope = maxPerDay
	} else if slope < -maxPerDay {
		slope = -maxPerDay
	}

	last := daily[len(daily)-1]
	totalDays := horizonEnd.Sub(last.day).Hours() / 24
	if totalDays <= 0 {
		return nil
	}

	numPoints := int(math.Ceil(totalDays / 7))
	if numPoints < 1 {
		numPoints = 1
	}
	if numPoints > forecastMaxPoints {
		numPoints = forecastMaxPoints
	}

	points := make([]models.WeightPlanProjectionPoint, 0, numPoints)
	for i := 1; i <= numPoints; i++ {
		days := totalDays * float64(i) / float64(numPoints)
		points = append(points, models.WeightPlanProjectionPoint{
			Week:           i,
			ExpectedWeight: last.weight + slope*days,
			ExpectedDate:   last.day.Add(time.Duration(days * float64(time.Hour) * 24)),
		})
	}
	return points
}

type dailyPoint struct {
	day    time.Time
	weight float64
}

// dailyWeights buckets logs to one point per UTC calendar day, sorted
// ascending. weight_logs already enforces one entry per calendar day (see
// WeightStore.UpsertForDay), so this is a defensive bucketing rather than a
// dedup that's expected to actually collapse anything — logged_at is stored
// UTC-normalized, so bucketing is done explicitly in UTC to match.
func dailyWeights(logs []models.WeightLog) []dailyPoint {
	sorted := make([]models.WeightLog, len(logs))
	copy(sorted, logs)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].LoggedAt.Before(sorted[j].LoggedAt) })

	byDay := map[time.Time]float64{}
	for _, l := range sorted {
		t := l.LoggedAt.UTC()
		day := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
		byDay[day] = l.Weight
	}
	points := make([]dailyPoint, 0, len(byDay))
	for d, w := range byDay {
		points = append(points, dailyPoint{day: d, weight: w})
	}
	sort.Slice(points, func(i, j int) bool { return points[i].day.Before(points[j].day) })
	return points
}

// olsSlopePerDay fits an ordinary-least-squares line to (day-offset, weight)
// and returns its slope in lbs/day. This regression is itself the smoothing
// mechanism — no separate moving-average pass is layered on top of it.
func olsSlopePerDay(daily []dailyPoint) float64 {
	n := float64(len(daily))
	if n < 2 {
		return 0
	}
	origin := daily[0].day
	var sumX, sumY, sumXY, sumXX float64
	for _, p := range daily {
		x := p.day.Sub(origin).Hours() / 24
		y := p.weight
		sumX += x
		sumY += y
		sumXY += x * y
		sumXX += x * x
	}
	denom := n*sumXX - sumX*sumX
	if denom == 0 {
		return 0
	}
	return (n*sumXY - sumX*sumY) / denom
}
