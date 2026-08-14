package controllers

import (
	"database/sql"
	"strconv"
	"time"

	"github.com/Cawlumm/lyftr-backend/middleware"
	"github.com/Cawlumm/lyftr-backend/models"
	"github.com/Cawlumm/lyftr-backend/stores"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/gin-gonic/gin"
)

// maxWorkoutListLimit bounds a single page of workout history. Each row carries
// its exercises and sets, so this is a memory ceiling, not a paranoia knob.
const maxWorkoutListLimit = 200

func (h *Handler) ListWorkouts(c *gin.Context) {
	uid := middleware.UserID(c)
	f := stores.WorkoutFilter{Limit: 20, Query: c.Query("q")}
	// Clamp rather than ignore. The old `l <= 100` guard silently dropped an
	// over-limit request back to the default of 20, so the dashboard asking for
	// 150 got 20 — and every "all-time" training metric it computed was wrong.
	if l, err := strconv.Atoi(c.Query("limit")); err == nil && l > 0 {
		if l > maxWorkoutListLimit {
			l = maxWorkoutListLimit
		}
		f.Limit = l
	}
	if o, err := strconv.Atoi(c.Query("offset")); err == nil && o >= 0 {
		f.Offset = o
	}
	workouts, err := h.s.Workout.List(uid, f)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, workouts)
}

func (h *Handler) GetWorkout(c *gin.Context) {
	uid := middleware.UserID(c)
	wid, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid workout id")
		return
	}
	w, err := h.s.Workout.Get(uid, wid)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "workout not found")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, w)
}

func (h *Handler) CreateWorkout(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.CreateWorkoutRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}
	if req.StartedAt.IsZero() {
		req.StartedAt = time.Now()
	}
	w, err := h.s.Workout.Create(uid, req)
	if utils.IsForeignKeyViolation(err) {
		utils.BadRequest(c, "one or more exercises do not exist")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.Created(c, w)
}

func (h *Handler) UpdateWorkout(c *gin.Context) {
	uid := middleware.UserID(c)
	wid, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid workout id")
		return
	}
	var req models.CreateWorkoutRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}
	w, err := h.s.Workout.Update(uid, wid, req)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "workout not found")
		return
	}
	if utils.IsForeignKeyViolation(err) {
		utils.BadRequest(c, "one or more exercises do not exist")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, w)
}

func (h *Handler) DeleteWorkout(c *gin.Context) {
	uid := middleware.UserID(c)
	wid, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid workout id")
		return
	}
	n, err := h.s.Workout.Delete(uid, wid)
	if utils.DBError(c, err) {
		return
	}
	if n == 0 {
		utils.NotFound(c, "workout not found")
		return
	}
	utils.OK(c, gin.H{"deleted": true})
}
