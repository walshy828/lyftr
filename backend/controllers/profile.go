package controllers

import (
	"database/sql"

	"github.com/Cawlumm/lyftr-backend/middleware"
	"github.com/Cawlumm/lyftr-backend/models"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/gin-gonic/gin"
)

// GetProfile returns the user's demographic profile plus a deterministically
// computed BMI/healthy-range readout composed from their latest logged
// weight — cross-entity composition happens here in the controller (the same
// pattern GetDailyStats uses for Food+Workout), never in a store.
func (h *Handler) GetProfile(c *gin.Context) {
	uid := middleware.UserID(c)
	p, err := h.s.Profile.Get(uid)
	if err == sql.ErrNoRows {
		p = models.DefaultUserProfile(uid)
	} else if utils.DBError(c, err) {
		return
	}

	bmi := models.BMIResult{}
	if p.HeightInches > 0 {
		stats, err := h.s.Weight.Stats(uid)
		if utils.DBError(c, err) {
			return
		}
		if stats.Latest > 0 {
			bmi.BMI = utils.BMI(stats.Latest, p.HeightInches)
			bmi.Category = utils.BMICategory(bmi.BMI)
		}
		bmi.HealthyRangeLow, bmi.HealthyRangeHigh = utils.HealthyWeightRangeLbs(p.HeightInches)
	}

	utils.OK(c, gin.H{
		"user_id":        p.UserID,
		"age":            p.Age,
		"sex":            p.Sex,
		"height_inches":  p.HeightInches,
		"activity_level": p.ActivityLevel,
		"bmi":            bmi,
	})
}

func (h *Handler) UpdateProfile(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.UpsertProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}
	p, err := h.s.Profile.Upsert(uid, req)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, p)
}
