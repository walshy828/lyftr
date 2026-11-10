package controllers

import (
	"github.com/Cawlumm/lyftr-backend/middleware"
	"github.com/Cawlumm/lyftr-backend/stores"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/gin-gonic/gin"
)

// GetTrainingGoals returns the weekly target for each training type
// (strength, cardio, mobility), defaults filled in for any never set.
//
//	GET /api/v1/training/goals
func (h *Handler) GetTrainingGoals(c *gin.Context) {
	goals, err := h.s.Training.Goals(middleware.UserID(c))
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, goals)
}

// PutTrainingGoals saves any subset of the three types' weekly targets.
//
//	PUT /api/v1/training/goals  [{"kind":"strength","days_per_week":3,"minutes_per_week":0}, ...]
func (h *Handler) PutTrainingGoals(c *gin.Context) {
	var goals []stores.TrainingGoal
	if err := c.ShouldBindJSON(&goals); err != nil {
		utils.BadRequest(c, "expected an array of goals")
		return
	}
	seen := map[string]bool{}
	for _, g := range goals {
		if !stores.ValidModality(g.Kind) || seen[g.Kind] {
			utils.BadRequest(c, "each goal needs a distinct kind: strength, cardio or mobility")
			return
		}
		seen[g.Kind] = true
		if g.DaysPerWeek < 0 || g.DaysPerWeek > 7 {
			utils.BadRequest(c, "days_per_week must be 0-7")
			return
		}
		// 7 days x 24 h: anything past that is a typo, not a goal.
		if g.MinutesPerWeek < 0 || g.MinutesPerWeek > 10080 {
			utils.BadRequest(c, "minutes_per_week must be 0-10080")
			return
		}
	}
	out, err := h.s.Training.SetGoals(middleware.UserID(c), goals)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, out)
}

// GetTrainingTypeDays returns each local day's sessions and minutes split by
// training type, logged workouts and watch-synced cardio merged. The Train
// hub's week strip and goal bars and the stats balance chart all read this,
// so they can never disagree about what counted.
//
//	GET /api/v1/training/days?from=&to=&tz_offset=
func (h *Handler) GetTrainingTypeDays(c *gin.Context) {
	from, to, tzOffset, _, ok := parseStatsWindow(c)
	if !ok {
		return
	}
	days, err := h.s.Training.TypeDays(middleware.UserID(c), from, to, tzOffset)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, days)
}
