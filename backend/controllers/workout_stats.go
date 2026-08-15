package controllers

import (
	"database/sql"
	"errors"
	"strconv"
	"strings"

	"github.com/Cawlumm/lyftr-backend/middleware"
	"github.com/Cawlumm/lyftr-backend/stores"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/gin-gonic/gin"
)

// GetWorkoutStats returns training aggregates over a date window.
//
//	GET /api/v1/workouts/stats?from=&to=&tz_offset=&include=daily,muscles,streak
//
// One composed endpoint rather than three, because with SetMaxOpenConns(1) the
// database is a serialization point: three requests are three queued round
// trips, where this is three queries behind one. `include` lets a caller that
// only needs the calendar skip the muscle and streak work.
//
// Dates are the CLIENT's local calendar days. The server stores no per-user
// timezone, so the client sends tz_offset (minutes to add to UTC) and is the
// authority on when its own day starts.
func (h *Handler) GetWorkoutStats(c *gin.Context) {
	uid := middleware.UserID(c)

	from, to, tzOffset, today, ok := parseStatsWindow(c)
	if !ok {
		return
	}

	include := parseInclude(c.Query("include"))

	// The unit rides along so the client can label volume without a second
	// request; weight is stored in whichever unit the user logs in.
	weightUnit := "lbs"
	if st, err := h.s.User.GetSettings(uid); err == nil {
		weightUnit = st.WeightUnit
	} else if !errors.Is(err, sql.ErrNoRows) {
		if utils.DBError(c, err) {
			return
		}
	}

	out := stores.TrainingStats{From: from, To: to, WeightUnit: weightUnit}

	// Totals are derived from the daily rows, so they need `daily` computed even
	// when the caller didn't ask for it back.
	daily, err := h.s.Workout.TrainingDaily(uid, from, to, tzOffset)
	if utils.DBError(c, err) {
		return
	}
	for _, d := range daily {
		out.Totals.Workouts += d.Workouts
		out.Totals.Duration += d.Duration
		out.Totals.Volume += d.Volume
		out.Totals.Sets += d.Sets
		out.Totals.ActiveDays++
	}
	if include["daily"] {
		out.Daily = daily
	}

	if include["muscles"] {
		muscles, err := h.s.Workout.TrainingMuscles(uid, from, to, tzOffset)
		if utils.DBError(c, err) {
			return
		}
		out.Muscles = muscles
	}

	if include["streak"] {
		streak, err := h.s.Workout.TrainingStreakFor(uid, today, tzOffset)
		if utils.DBError(c, err) {
			return
		}
		out.Streak = &streak
	}

	utils.OK(c, out)
}

// parseInclude reads the comma-separated section list. An empty or absent
// value means everything — the dashboard's case, and the friendlier default
// than making every caller enumerate.
func parseInclude(raw string) map[string]bool {
	all := map[string]bool{"daily": true, "muscles": true, "streak": true}
	if strings.TrimSpace(raw) == "" {
		return all
	}
	out := map[string]bool{}
	for _, part := range strings.Split(raw, ",") {
		part = strings.ToLower(strings.TrimSpace(part))
		if all[part] {
			out[part] = true
		}
	}
	return out
}

// GetRecentPRs lists each exercise's current best set, newest record first.
//
//	GET /api/v1/workouts/prs?limit=
func (h *Handler) GetRecentPRs(c *gin.Context) {
	uid := middleware.UserID(c)

	limit := 20
	if l, err := strconv.Atoi(c.Query("limit")); err == nil && l > 0 {
		if l > 100 {
			l = 100
		}
		limit = l
	}

	prs, err := h.s.Workout.RecentPRs(uid, limit)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, prs)
}
