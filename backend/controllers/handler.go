package controllers

import (
	"github.com/Cawlumm/lyftr-backend/stores"
	"github.com/Cawlumm/lyftr-backend/vision"
)

// Handler carries the injected stores. Every HTTP handler is a method on Handler
// so it reaches the database only through h.s.<Entity>, never the global db.DB.
type Handler struct {
	s      *stores.Stores
	vision vision.Provider // nil if photo-import isn't configured
}

func NewHandler(s *stores.Stores, v vision.Provider) *Handler { return &Handler{s: s, vision: v} }
