package controllers

import (
	"database/sql"
	"errors"
	"strconv"
	"time"

	"github.com/Cawlumm/lyftr-backend/middleware"
	"github.com/Cawlumm/lyftr-backend/models"
	"github.com/Cawlumm/lyftr-backend/stores"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/gin-gonic/gin"
)

// maxScheduleSpanDays bounds a schedule query. A month view plus its
// leading/trailing partial weeks is ~42 days; this leaves room for a quarter.
const maxScheduleSpanDays = 120

// GetSchedule resolves the training plan for a date range.
//
//	GET /api/v1/schedule?from=&to=&tz_offset=
//
// The client sends its own local dates. The server stores no per-user timezone,
// and a schedule that shows tomorrow's session at 8pm tonight is the fastest
// way to make the feature untrusted.
func (h *Handler) GetSchedule(c *gin.Context) {
	uid := middleware.UserID(c)

	tzOffset := 0
	if v, err := strconv.Atoi(c.Query("tz_offset")); err == nil {
		tzOffset = v
	}
	today := stores.LocalToday(tzOffset)

	from, to := today, today
	if raw := c.Query("from"); raw != "" {
		t, err := time.Parse(isoDate, raw)
		if err != nil {
			utils.BadRequest(c, "from must be a YYYY-MM-DD date")
			return
		}
		from = t.Format(isoDate)
	}
	if raw := c.Query("to"); raw != "" {
		t, err := time.Parse(isoDate, raw)
		if err != nil {
			utils.BadRequest(c, "to must be a YYYY-MM-DD date")
			return
		}
		to = t.Format(isoDate)
	}
	if from > to {
		utils.BadRequest(c, "from must not be after to")
		return
	}
	fromTime, _ := time.Parse(isoDate, from)
	toTime, _ := time.Parse(isoDate, to)
	if int(toTime.Sub(fromTime).Hours()/24)+1 > maxScheduleSpanDays {
		utils.BadRequest(c, "date range must not exceed "+strconv.Itoa(maxScheduleSpanDays)+" days")
		return
	}

	days, err := h.s.Schedule.Resolve(uid, from, to, tzOffset)
	if utils.DBError(c, err) {
		return
	}
	recurring, err := h.s.Schedule.Recurring(uid)
	if utils.DBError(c, err) {
		return
	}

	utils.OK(c, gin.H{"from": from, "to": to, "days": days, "recurring": recurring})
}

// GetTodaysWorkout answers "what am I doing today" for the dashboard.
//
//	GET /api/v1/schedule/today?date=&tz_offset=
func (h *Handler) GetTodaysWorkout(c *gin.Context) {
	uid := middleware.UserID(c)

	tzOffset := 0
	if v, err := strconv.Atoi(c.Query("tz_offset")); err == nil {
		tzOffset = v
	}
	date := stores.LocalToday(tzOffset)
	if raw := c.Query("date"); raw != "" {
		t, err := time.Parse(isoDate, raw)
		if err != nil {
			utils.BadRequest(c, "date must be a YYYY-MM-DD date")
			return
		}
		date = t.Format(isoDate)
	}

	days, err := h.s.Schedule.Resolve(uid, date, date, tzOffset)
	if utils.DBError(c, err) {
		return
	}
	if len(days) == 0 {
		utils.OK(c, nil)
		return
	}
	utils.OK(c, days[0])
}

// ReplaceSchedule swaps the whole recurring weekly pattern.
//
//	PUT /api/v1/schedule   {"days": {"1": [3, 7], "4": [3]}}
func (h *Handler) ReplaceSchedule(c *gin.Context) {
	uid := middleware.UserID(c)

	var req models.ReplaceScheduleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.ValidationError(c, err)
		return
	}

	days := map[int][]int64{}
	for key, programIDs := range req.Days {
		weekday, err := strconv.Atoi(key)
		if err != nil || weekday < 0 || weekday > 6 {
			utils.BadRequest(c, "weekday keys must be 0 (Sunday) through 6 (Saturday)")
			return
		}
		if len(programIDs) > maxProgramsPerDay {
			utils.BadRequest(c, "too many programs on one day")
			return
		}
		// Every program is verified to belong to this user. Program.Get is
		// already user-scoped, so a borrowed id 404s rather than being
		// scheduled. A *shared* program must be copied first — otherwise the
		// owner unsharing it would silently empty someone else's calendar.
		if err := h.verifyOwnedPrograms(c, uid, programIDs); err != nil {
			return
		}
		days[weekday] = programIDs
	}

	if err := h.s.Schedule.ReplaceRecurring(uid, days); utils.DBError(c, err) {
		return
	}

	recurring, err := h.s.Schedule.Recurring(uid)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, gin.H{"recurring": recurring})
}

// SetScheduleOverride replaces one date's plan without touching the pattern.
//
//	POST /api/v1/schedule/overrides   {"date": "2026-08-17", "program_ids": [7]}
//
// An empty or omitted program_ids marks the date an explicit rest day, which is
// different from having no override (that falls through to the pattern).
func (h *Handler) SetScheduleOverride(c *gin.Context) {
	uid := middleware.UserID(c)

	var req models.SetScheduleOverrideRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.ValidationError(c, err)
		return
	}
	t, err := time.Parse(isoDate, req.Date)
	if err != nil {
		utils.BadRequest(c, "date must be a YYYY-MM-DD date")
		return
	}
	if len(req.ProgramIDs) > maxProgramsPerDay {
		utils.BadRequest(c, "too many programs on one day")
		return
	}
	if err := h.verifyOwnedPrograms(c, uid, req.ProgramIDs); err != nil {
		return
	}

	if err := h.s.Schedule.SetOverride(uid, t.Format(isoDate), req.ProgramIDs); utils.DBError(c, err) {
		return
	}

	days, err := h.s.Schedule.Resolve(uid, t.Format(isoDate), t.Format(isoDate), 0)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, days[0])
}

// ClearScheduleOverride reverts a date to the recurring pattern.
//
//	DELETE /api/v1/schedule/overrides/:date
func (h *Handler) ClearScheduleOverride(c *gin.Context) {
	uid := middleware.UserID(c)

	t, err := time.Parse(isoDate, c.Param("date"))
	if err != nil {
		utils.BadRequest(c, "date must be a YYYY-MM-DD date")
		return
	}
	if err := h.s.Schedule.ClearOverride(uid, t.Format(isoDate)); utils.DBError(c, err) {
		return
	}

	days, err := h.s.Schedule.Resolve(uid, t.Format(isoDate), t.Format(isoDate), 0)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, days[0])
}

// maxProgramsPerDay is a sanity bound, not a training opinion — it exists so a
// malformed request can't insert thousands of rows for one day.
const maxProgramsPerDay = 10

// verifyOwnedPrograms 404s the request unless every id belongs to the caller.
// Writes the response itself and returns a non-nil error when it did.
func (h *Handler) verifyOwnedPrograms(c *gin.Context, uid int64, ids []int64) error {
	for _, id := range ids {
		if _, err := h.s.Program.Get(uid, id); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				utils.NotFound(c, "program not found")
				return err
			}
			utils.DBError(c, err)
			return err
		}
	}
	return nil
}
