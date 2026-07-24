package utils

import (
	"math"
	"testing"
	"time"

	"github.com/Cawlumm/lyftr-backend/models"
)

func mkLog(daysAgo int, weight float64, base time.Time) models.WeightLog {
	return models.WeightLog{Weight: weight, LoggedAt: base.AddDate(0, 0, -daysAgo)}
}

func TestForecastActualWeight_steadyDecline(t *testing.T) {
	base := time.Date(2026, 1, 29, 12, 0, 0, 0, time.UTC)
	logs := []models.WeightLog{
		mkLog(6, 210, base),
		mkLog(5, 209, base),
		mkLog(4, 208, base),
		mkLog(3, 207, base),
		mkLog(2, 206, base),
		mkLog(1, 205, base),
		mkLog(0, 204, base),
	}
	guidance := models.WeeklyLossGuidance{LowLbsPerWeek: 1, HighLbsPerWeek: 2}
	horizon := base.AddDate(0, 0, 21)

	points := ForecastActualWeight(logs, guidance, horizon)
	if len(points) == 0 {
		t.Fatalf("expected forecast points, got none")
	}
	last := points[len(points)-1]
	// ~1 lb/day decline clamped to guidance's 2 lbs/week (~0.286 lbs/day) —
	// 21 days out should land noticeably below the last actual (204), but not
	// anywhere near an unclamped ~21 lb drop.
	if last.ExpectedWeight >= 204 {
		t.Fatalf("expected forecast to continue declining, got %v", last.ExpectedWeight)
	}
	if last.ExpectedWeight < 204-21*2.0/7-0.5 {
		t.Fatalf("forecast exceeded the clamped pace: %v", last.ExpectedWeight)
	}
}

func TestForecastActualWeight_clampsOutlierSpike(t *testing.T) {
	base := time.Date(2026, 1, 29, 0, 0, 0, 0, time.UTC)
	// Flat at 200 except one big one-day spike to 215 right before "now".
	logs := []models.WeightLog{
		mkLog(6, 200, base),
		mkLog(5, 200, base),
		mkLog(4, 200, base),
		mkLog(3, 200, base),
		mkLog(2, 200, base),
		mkLog(1, 215, base), // outlier swing
		mkLog(0, 200, base),
	}
	guidance := models.WeeklyLossGuidance{LowLbsPerWeek: 0.5, HighLbsPerWeek: 1}
	horizon := base.AddDate(0, 0, 14)

	points := ForecastActualWeight(logs, guidance, horizon)
	if len(points) == 0 {
		t.Fatalf("expected forecast points, got none")
	}
	last := points[len(points)-1]
	// Even with the spike, the clamp (2 lbs/week — the fallback floor, since
	// it's higher than this plan's 1 lb/week guidance) bounds how far the
	// forecast can move in 14 days (4 lbs) — it must not swing wildly off 200.
	if diff := math.Abs(last.ExpectedWeight - 200); diff > 4.5 {
		t.Fatalf("forecast over-reacted to a one-day swing: last=%v (diff=%v)", last.ExpectedWeight, diff)
	}
}

func TestForecastActualWeight_insufficientData(t *testing.T) {
	base := time.Date(2026, 1, 29, 12, 0, 0, 0, time.UTC)
	guidance := models.WeeklyLossGuidance{HighLbsPerWeek: 2}
	horizon := base.AddDate(0, 0, 14)

	if got := ForecastActualWeight(nil, guidance, horizon); got != nil {
		t.Fatalf("expected nil for no logs, got %v", got)
	}
	if got := ForecastActualWeight([]models.WeightLog{mkLog(0, 200, base)}, guidance, horizon); got != nil {
		t.Fatalf("expected nil for a single log, got %v", got)
	}
	// Two distinct days is still below the 3-day minimum.
	two := []models.WeightLog{mkLog(1, 201, base), mkLog(0, 200, base)}
	if got := ForecastActualWeight(two, guidance, horizon); got != nil {
		t.Fatalf("expected nil for two days of data, got %v", got)
	}
}

func TestForecastActualWeight_flatWeightNearZeroSlope(t *testing.T) {
	base := time.Date(2026, 1, 29, 12, 0, 0, 0, time.UTC)
	logs := []models.WeightLog{
		mkLog(6, 180, base),
		mkLog(4, 180.2, base),
		mkLog(2, 179.8, base),
		mkLog(0, 180, base),
	}
	guidance := models.WeeklyLossGuidance{HighLbsPerWeek: 2}
	horizon := base.AddDate(0, 0, 14)

	points := ForecastActualWeight(logs, guidance, horizon)
	if len(points) == 0 {
		t.Fatalf("expected forecast points, got none")
	}
	last := points[len(points)-1]
	if diff := math.Abs(last.ExpectedWeight - 180); diff > 1 {
		t.Fatalf("expected roughly flat forecast, got %v (diff=%v)", last.ExpectedWeight, diff)
	}
}

func TestForecastActualWeight_horizonNotInFuture(t *testing.T) {
	base := time.Date(2026, 1, 29, 12, 0, 0, 0, time.UTC)
	logs := []models.WeightLog{mkLog(4, 200, base), mkLog(2, 199, base), mkLog(0, 198, base)}
	guidance := models.WeeklyLossGuidance{HighLbsPerWeek: 2}

	if got := ForecastActualWeight(logs, guidance, base.AddDate(0, 0, -1)); got != nil {
		t.Fatalf("expected nil when horizon is in the past, got %v", got)
	}
}
