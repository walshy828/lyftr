package controllers

import (
	"github.com/Cawlumm/lyftr-backend/middleware"
	"github.com/Cawlumm/lyftr-backend/stores"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/gin-gonic/gin"
)

// CardioTotals summarizes the window. Derived in Go from the daily rows, so
// it costs no extra query — mirrors TrainingTotals.
type CardioTotals struct {
	Sessions       int     `json:"sessions"`
	Duration       int     `json:"duration"`
	DistanceMeters float64 `json:"distance_meters"`
	Calories       float64 `json:"calories"`
	ActiveDays     int     `json:"active_days"`
}

// CardioStats is the composed payload, mirroring stores.TrainingStats.
// CombinedStreak is only populated when the caller asks for it via
// ?combined_streak=1 — it's a cross-entity query (workouts + cardio_sessions)
// so it's opt-in rather than bundled into every response.
type CardioStats struct {
	From           string                 `json:"from"`
	To             string                 `json:"to"`
	Totals         CardioTotals           `json:"totals"`
	Daily          []stores.CardioDay     `json:"daily,omitempty"`
	Streak         *stores.TrainingStreak `json:"streak,omitempty"`
	CombinedStreak *stores.TrainingStreak `json:"combined_streak,omitempty"`
}

// GetCardioStats returns cardio aggregates over a date window.
//
//	GET /api/v1/cardio/stats?from=&to=&tz_offset=&include=daily,streak&combined_streak=1
//
// Mirrors GetWorkoutStats's shape. `combined_streak=1` additionally computes
// the streak across BOTH workouts and cardio_sessions (a day counts if it had
// either), for the dashboard's "both" toggle position — see
// CardioStore.CombinedStreakFor for why that can't be derived from this
// endpoint's own streak plus the workout endpoint's streak.
func (h *Handler) GetCardioStats(c *gin.Context) {
	uid := middleware.UserID(c)

	from, to, tzOffset, today, ok := parseStatsWindow(c)
	if !ok {
		return
	}

	include := parseInclude(c.Query("include"))

	out := CardioStats{From: from, To: to}

	daily, err := h.s.Cardio.CardioDaily(uid, from, to, tzOffset)
	if utils.DBError(c, err) {
		return
	}
	for _, d := range daily {
		out.Totals.Sessions += d.Sessions
		out.Totals.Duration += d.Duration
		out.Totals.DistanceMeters += d.DistanceMeters
		out.Totals.Calories += d.Calories
		out.Totals.ActiveDays++
	}
	if include["daily"] {
		out.Daily = daily
	}

	if include["streak"] {
		streak, err := h.s.Cardio.CardioStreakFor(uid, today, tzOffset)
		if utils.DBError(c, err) {
			return
		}
		out.Streak = &streak
	}

	if c.Query("combined_streak") != "" {
		combined, err := h.s.Cardio.CombinedStreakFor(uid, today, tzOffset)
		if utils.DBError(c, err) {
			return
		}
		out.CombinedStreak = &combined
	}

	utils.OK(c, out)
}
