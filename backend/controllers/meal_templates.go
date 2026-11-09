package controllers

import (
	"database/sql"
	"strconv"

	"github.com/Cawlumm/lyftr-backend/middleware"
	"github.com/Cawlumm/lyftr-backend/models"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/gin-gonic/gin"
)

// Saved meals ("meal templates"): a named group of foods eaten together,
// logged in one tap from the Log sheet. Built from entries already in the
// diary, so saving a meal never means re-entering it.

func (h *Handler) ListMealTemplates(c *gin.Context) {
	uid := middleware.UserID(c)
	list, err := h.s.MealTemplate.List(uid)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, list)
}

func (h *Handler) CreateMealTemplate(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.CreateMealTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}
	t, err := h.s.MealTemplate.CreateFromEntries(uid, req.Name, req.EntryIDs)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "none of those entries were found")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.Created(c, t)
}

func (h *Handler) RenameMealTemplate(c *gin.Context) {
	uid := middleware.UserID(c)
	id, ok := templateID(c)
	if !ok {
		return
	}
	var req models.RenameMealTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}
	t, err := h.s.MealTemplate.Rename(uid, id, req.Name)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "meal not found")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, t)
}

func (h *Handler) DeleteMealTemplate(c *gin.Context) {
	uid := middleware.UserID(c)
	id, ok := templateID(c)
	if !ok {
		return
	}
	t, err := h.s.MealTemplate.Get(uid, id)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "meal not found")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	if _, err := h.s.MealTemplate.Delete(uid, id); utils.DBError(c, err) {
		return
	}
	// The template may have been the last holder of an item's photo.
	for _, it := range t.Items {
		h.removePhotoIfUnused(uid, it.ImageURL, "food/templates delete")
	}
	utils.OK(c, gin.H{"deleted": true})
}

func (h *Handler) LogMealTemplate(c *gin.Context) {
	uid := middleware.UserID(c)
	id, ok := templateID(c)
	if !ok {
		return
	}
	var req models.LogMealTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}
	logs, err := h.s.MealTemplate.Log(uid, id, req.LoggedAt, req.Meal)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "meal not found")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.Created(c, logs)
}

func templateID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid id")
		return 0, false
	}
	return id, true
}
