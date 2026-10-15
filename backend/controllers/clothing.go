package controllers

import (
	"database/sql"
	"errors"
	"strconv"

	"github.com/Cawlumm/lyftr-backend/middleware"
	"github.com/Cawlumm/lyftr-backend/models"
	"github.com/Cawlumm/lyftr-backend/stores"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/gin-gonic/gin"
)

// ListClothingProfiles returns the user's weigh-in outfits, seeding the
// starter set (and linking existing entries to the default) on first use.
func (h *Handler) ListClothingProfiles(c *gin.Context) {
	uid := middleware.UserID(c)
	if utils.DBError(c, h.s.Clothing.EnsureDefaults(uid)) {
		return
	}
	profiles, err := h.s.Clothing.List(uid)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, profiles)
}

func (h *Handler) CreateClothingProfile(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.ClothingProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}
	if utils.DBError(c, h.s.Clothing.EnsureDefaults(uid)) {
		return
	}
	p, err := h.s.Clothing.Create(uid, req)
	if utils.DBError(c, err) {
		return
	}
	utils.Created(c, p)
}

func (h *Handler) UpdateClothingProfile(c *gin.Context) {
	uid := middleware.UserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid id")
		return
	}
	var req models.ClothingProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}
	p, err := h.s.Clothing.Update(uid, id, req)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "clothing profile not found")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, p)
}

func (h *Handler) DeleteClothingProfile(c *gin.Context) {
	uid := middleware.UserID(c)
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid id")
		return
	}
	err = h.s.Clothing.Delete(uid, id)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "clothing profile not found")
		return
	}
	if errors.Is(err, stores.ErrDefaultProfile) {
		utils.Conflict(c, err.Error())
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, gin.H{"deleted": true})
}

// checkClothingProfile verifies a client-supplied profile id belongs to the
// user. Returns false (response already written) when it doesn't.
func (h *Handler) checkClothingProfile(c *gin.Context, uid int64, id *int64) bool {
	if id == nil {
		return true
	}
	if _, err := h.s.Clothing.Get(uid, *id); err == sql.ErrNoRows {
		utils.BadRequest(c, "unknown clothing profile")
		return false
	} else if utils.DBError(c, err) {
		return false
	}
	return true
}
