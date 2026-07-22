package controllers

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/Cawlumm/lyftr-backend/middleware"
	"github.com/Cawlumm/lyftr-backend/models"
	"github.com/Cawlumm/lyftr-backend/stores"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/Cawlumm/lyftr-backend/vision"
	"github.com/gin-gonic/gin"
)

// programSort whitelists the sort query param — never pass raw user input to ORDER BY.
func programSort(c *gin.Context) string {
	switch c.Query("sort") {
	case "name", "created":
		return c.Query("sort")
	default:
		return "smart"
	}
}

func (h *Handler) ListPrograms(c *gin.Context) {
	uid := middleware.UserID(c)
	f := stores.ProgramFilter{Limit: 20, Query: c.Query("q"), Sort: programSort(c)}
	if l, err := strconv.Atoi(c.Query("limit")); err == nil && l > 0 && l <= 100 {
		f.Limit = l
	}
	if o, err := strconv.Atoi(c.Query("offset")); err == nil && o >= 0 {
		f.Offset = o
	}
	programs, err := h.s.Program.List(uid, f)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, programs)
}

func (h *Handler) ListSharedPrograms(c *gin.Context) {
	uid := middleware.UserID(c)
	f := stores.ProgramFilter{Limit: 20, Query: c.Query("q"), Sort: programSort(c)}
	if l, err := strconv.Atoi(c.Query("limit")); err == nil && l > 0 && l <= 100 {
		f.Limit = l
	}
	if o, err := strconv.Atoi(c.Query("offset")); err == nil && o >= 0 {
		f.Offset = o
	}
	programs, err := h.s.Program.ListShared(uid, f)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, programs)
}

func (h *Handler) GetProgram(c *gin.Context) {
	uid := middleware.UserID(c)
	pid, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid program id")
		return
	}
	p, err := h.s.Program.Get(uid, pid)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "program not found")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, p)
}

func (h *Handler) CreateProgram(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.CreateProgramRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}
	p, err := h.s.Program.Create(uid, req)
	if utils.IsForeignKeyViolation(err) {
		utils.BadRequest(c, "one or more exercises do not exist")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.Created(c, p)
}

func (h *Handler) UpdateProgram(c *gin.Context) {
	uid := middleware.UserID(c)
	pid, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid program id")
		return
	}
	var req models.CreateProgramRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}
	p, err := h.s.Program.Update(uid, pid, req)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "program not found")
		return
	}
	if utils.IsForeignKeyViolation(err) {
		utils.BadRequest(c, "one or more exercises do not exist")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, p)
}

func (h *Handler) DeleteProgram(c *gin.Context) {
	uid := middleware.UserID(c)
	pid, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid program id")
		return
	}
	n, err := h.s.Program.Delete(uid, pid)
	if utils.DBError(c, err) {
		return
	}
	if n == 0 {
		utils.NotFound(c, "program not found")
		return
	}
	utils.OK(c, gin.H{"deleted": true})
}

func (h *Handler) ShareProgram(c *gin.Context) {
	h.setProgramShared(c, true)
}

func (h *Handler) UnshareProgram(c *gin.Context) {
	h.setProgramShared(c, false)
}

func (h *Handler) setProgramShared(c *gin.Context, shared bool) {
	uid := middleware.UserID(c)
	pid, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid program id")
		return
	}
	p, err := h.s.Program.SetShared(uid, pid, shared)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "program not found")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, p)
}

// truncateErr renders a provider error safely for display in an API response.
// The underlying SDK errors are HTTP-status/message text (invalid model,
// rate limit, schema rejection, etc.) with no secrets embedded, but callers
// can be verbose (e.g. echoing a full request body), so this caps length
// and collapses newlines to keep the response a single readable line.
func truncateErr(err error) string {
	s := strings.ReplaceAll(err.Error(), "\n", " ")
	const max = 200
	if len(s) > max {
		s = s[:max] + "…"
	}
	return s
}

// GenerateProgram proposes one or more draft workout programs from a
// free-text description of goals/focus areas/equipment/time period, via the
// same configured vision/AI provider as the food-vision endpoints. The
// result is always a suggestion: nothing is written to the programs table
// here — the frontend reviews/edits each draft and creates it via the
// existing CreateProgram endpoint.
func (h *Handler) GenerateProgram(c *gin.Context) {
	var req models.GenerateProgramRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}
	if h.vision == nil {
		utils.ServiceUnavailable(c, "AI program builder is not configured on this server")
		return
	}

	catalog, err := h.s.Exercise.List(stores.ExerciseFilter{Limit: 1000})
	if utils.DBError(c, err) {
		return
	}
	refs := make([]vision.ExerciseRef, len(catalog))
	for i, e := range catalog {
		refs[i] = vision.ExerciseRef{ID: e.ID, Name: e.Name, MuscleGroup: e.MuscleGroup, Equipment: e.Equipment, Category: e.Category}
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()

	programs, err := h.vision.GenerateProgram(ctx, vision.GenerateProgramRequest{
		Goals:        req.Goals,
		FocusAreas:   req.FocusAreas,
		Equipment:    req.Equipment,
		TimePeriod:   req.TimePeriod,
		NumberOfDays: req.NumberOfDays,
		Catalog:      refs,
	})
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			log.Printf("[programs/generate] timed out after 20s")
			utils.ServiceUnavailable(c, "program generation timed out — try again or build manually")
			return
		}
		log.Printf("[programs/generate] vision error: %v", err)
		utils.ServiceUnavailable(c, fmt.Sprintf("could not generate a program — try again or build manually (%s)", truncateErr(err)))
		return
	}
	utils.OK(c, gin.H{"programs": programs})
}

func (h *Handler) CopyProgram(c *gin.Context) {
	uid := middleware.UserID(c)
	pid, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid program id")
		return
	}
	p, err := h.s.Program.Copy(uid, pid)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "program not found")
		return
	}
	if utils.IsForeignKeyViolation(err) {
		utils.BadRequest(c, "one or more exercises do not exist")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.Created(c, p)
}
