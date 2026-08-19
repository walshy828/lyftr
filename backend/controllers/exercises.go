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

// maxExerciseImageBytes caps the base64-encoded photo payload accepted for a
// custom exercise's image_url, mirroring maxLabelImageBytes in food.go.
const maxExerciseImageBytes = 5_600_000

func (h *Handler) ListExercises(c *gin.Context) {
	f := stores.ExerciseFilter{
		Query:       c.Query("q"),
		MuscleGroup: c.Query("muscle_group"),
		Category:    c.Query("category"),
		Equipment:   c.Query("equipment"),
		Level:       c.Query("level"),
		Force:       c.Query("force"),
		Mechanic:    c.Query("mechanic"),
		Limit:       100,
	}
	// Clamp rather than ignore, so an over-limit request doesn't silently
	// collapse to the default (see the same bug in ListWorkouts).
	if l, err := strconv.Atoi(c.Query("limit")); err == nil && l > 0 {
		if l > maxExerciseListLimit {
			l = maxExerciseListLimit
		}
		f.Limit = l
	}
	exercises, err := h.s.Exercise.List(f)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, exercises)
}

// maxExerciseListLimit comfortably exceeds the whole catalog (~870), so a
// client asking for "everything" gets everything.
const maxExerciseListLimit = 2000

// exerciseWriteBody is the shared shape for creating and editing a custom
// exercise: name, muscle groups worked, equipment, instructions, and photo.
type exerciseWriteBody struct {
	Name             string   `json:"name"`
	MuscleGroup      string   `json:"muscle_group"`
	SecondaryMuscles []string `json:"secondary_muscles"`
	Category         string   `json:"category"`
	Equipment        string   `json:"equipment"`
	Description      string   `json:"description"`
	ImageURL         string   `json:"image_url"`
}

// bindAndValidate parses+trims the shared write body and enforces the common
// rules (name/muscle_group required, image size cap). It writes the error
// response itself and returns ok=false when validation fails.
func bindExerciseWrite(c *gin.Context) (exerciseWriteBody, bool) {
	var body exerciseWriteBody
	if err := c.ShouldBindJSON(&body); err != nil {
		utils.BadRequest(c, "invalid request body")
		return body, false
	}
	body.Name = strings.TrimSpace(body.Name)
	body.MuscleGroup = strings.TrimSpace(body.MuscleGroup)
	body.Equipment = strings.TrimSpace(body.Equipment)
	body.Category = strings.TrimSpace(body.Category)
	if body.Name == "" || body.MuscleGroup == "" {
		utils.BadRequest(c, "name and muscle_group are required")
		return body, false
	}
	if len(body.ImageURL) > maxExerciseImageBytes {
		utils.BadRequest(c, "image_url exceeds size limit")
		return body, false
	}
	return body, true
}

// CreateExercise adds a user-defined exercise. It joins the same global,
// shared catalog every other exercise lives in (this is a single-user
// self-hosted app) so it shows up in search/filters/the picker immediately.
func (h *Handler) CreateExercise(c *gin.Context) {
	body, ok := bindExerciseWrite(c)
	if !ok {
		return
	}
	e, err := h.s.Exercise.Create(body.Name, body.MuscleGroup, body.Equipment, body.Category, body.Description, body.ImageURL, body.SecondaryMuscles)
	if utils.IsUniqueViolation(err) {
		utils.Conflict(c, "an exercise with that name already exists")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.Created(c, e)
}

// UpdateExercise edits a custom exercise. Library exercises (source != custom)
// can't be edited.
func (h *Handler) UpdateExercise(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid exercise id")
		return
	}
	body, ok := bindExerciseWrite(c)
	if !ok {
		return
	}
	e, err := h.s.Exercise.Update(id, body.Name, body.MuscleGroup, body.Equipment, body.Category, body.Description, body.ImageURL, body.SecondaryMuscles)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		utils.NotFound(c, "exercise not found")
		return
	case errors.Is(err, stores.ErrNotCustomExercise):
		utils.Forbidden(c, "only custom exercises can be edited")
		return
	case utils.IsUniqueViolation(err):
		utils.Conflict(c, "an exercise with that name already exists")
		return
	case utils.DBError(c, err):
		return
	}
	utils.OK(c, e)
}

// DeleteExercise removes a custom exercise. Library exercises can't be
// deleted, and a custom exercise still referenced by a workout or program
// can't be deleted either (409) until that reference is removed.
func (h *Handler) DeleteExercise(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid exercise id")
		return
	}
	err = h.s.Exercise.Delete(id)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		utils.NotFound(c, "exercise not found")
		return
	case errors.Is(err, stores.ErrNotCustomExercise):
		utils.Forbidden(c, "only custom exercises can be deleted")
		return
	case errors.Is(err, stores.ErrExerciseInUse):
		utils.Conflict(c, "cannot delete: this exercise is used in an existing workout or program")
		return
	case utils.DBError(c, err):
		return
	}
	utils.OK(c, gin.H{"deleted": true})
}

// GetExerciseFacets returns the distinct filter values with counts, so the
// browse page can render chips without hardcoding a taxonomy owned upstream.
func (h *Handler) GetExerciseFacets(c *gin.Context) {
	facets, err := h.s.Exercise.Facets()
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, facets)
}

func (h *Handler) GetExercise(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid exercise id")
		return
	}
	e, err := h.s.Exercise.Get(id)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "exercise not found")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, e)
}

func (h *Handler) GetExercisePRs(c *gin.Context) {
	uid := middleware.UserID(c)
	exerciseID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid exercise id")
		return
	}
	pr, err := h.s.Workout.PRForExercise(uid, exerciseID)
	if err == sql.ErrNoRows {
		utils.OK(c, nil)
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, gin.H{
		"weight":        pr.Weight,
		"reps":          pr.Reps,
		"estimated_1rm": utils.Epley1RM(pr.Weight, pr.Reps),
		"date":          pr.Date,
		"workout_id":    pr.WorkoutID,
	})
}

func (h *Handler) GetExerciseHistory(c *gin.Context) {
	uid := middleware.UserID(c)
	exerciseID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid exercise id")
		return
	}
	limit := 20
	if l, err := strconv.Atoi(c.Query("limit")); err == nil && l > 0 && l <= 100 {
		limit = l
	}
	history, err := h.s.Workout.HistoryForExercise(uid, exerciseID, limit)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, history)
}

// SyncExercises is an admin-only endpoint to re-pull from ExerciseDB.
func (h *Handler) SyncExercises(c *gin.Context) {
	if err := h.s.Exercise.Sync(); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	count, err := h.s.Exercise.Count()
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, gin.H{"synced": true, "total": count})
}

// ExerciseSeedStatus returns exercise count and whether seeding is running.
func (h *Handler) ExerciseSeedStatus(c *gin.Context) {
	utils.OK(c, h.s.Exercise.SeedStatus())
}

// ResetExercises wipes the exercises table and triggers a fresh seed in background.
func (h *Handler) ResetExercises(c *gin.Context) {
	if err := h.s.Exercise.Reset(); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	utils.OK(c, gin.H{"reset": true, "message": "exercises wiped, re-seeding in background"})
}
