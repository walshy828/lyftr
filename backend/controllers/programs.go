package controllers

import (
	"database/sql"
	"strconv"

	"github.com/Cawlumm/lyftr-backend/middleware"
	"github.com/Cawlumm/lyftr-backend/models"
	"github.com/Cawlumm/lyftr-backend/stores"
	"github.com/Cawlumm/lyftr-backend/utils"
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
