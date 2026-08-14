package controllers

import (
	"database/sql"
	"log"
	"strconv"

	"github.com/Cawlumm/lyftr-backend/config"
	"github.com/Cawlumm/lyftr-backend/seed"
	"github.com/Cawlumm/lyftr-backend/storage"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/gin-gonic/gin"
)

// frameNames maps the URL's readable frame name to its upstream index. Named
// rather than numbered in the URL because "start"/"end" is what the pair
// actually means — the start and end positions of the movement.
var frameNames = map[string]int{"start": 0, "end": 1}

// ServeExerciseImage serves one frame of an exercise's movement from the local
// cache, downloading it from the upstream dataset on first request.
//
//	GET /api/v1/exercises/:id/image
//	GET /api/v1/exercises/:id/image/:frame   (frame = "start" | "end")
//
// This route is deliberately NOT behind middleware.Auth, the only such route
// besides /health and /info. An <img src> cannot send an Authorization header,
// and this middleware only reads bearer tokens from that header — so behind
// auth every image in an ~870-row grid would have to be fetched by the API
// client and turned into a blob URL, which defeats HTTP caching, defeats the
// service worker's offline cache, and holds hundreds of blobs in memory.
//
// ServeMealPhoto is authenticated because a meal photo is the user's own
// private data. An exercise demo frame is a public file that GitHub already
// serves anonymously to anyone; it carries nothing about the user, and which
// exercises exist in the catalog is not a secret.
func (h *Handler) ServeExerciseImage(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.NotFound(c, "exercise not found")
		return
	}

	frame := 0
	if name := c.Param("frame"); name != "" {
		f, ok := frameNames[name]
		if !ok {
			utils.NotFound(c, "unknown frame")
			return
		}
		frame = f
	}

	e, err := h.s.Exercise.Get(id)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "exercise not found")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	// Rows seeded before the library enrichment have no source_id until the
	// next admin sync backfills them.
	if e.SourceID == "" {
		utils.NotFound(c, "no image for this exercise")
		return
	}

	path, err := storage.EnsureExerciseImage(config.C.ExerciseImageDir, seed.ImageBaseURL, e.SourceID, frame)
	if err != nil {
		// 404, not 502. Plenty of exercises have only a start frame, and a
		// missing picture must never break the grid it sits in — the client
		// falls back to the other frame or an icon.
		log.Printf("exercise image %d frame %d: %v", id, frame, err)
		utils.NotFound(c, "no image for this exercise")
		return
	}

	// The bytes for a given (exercise, frame) never change.
	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	c.File(path)
}
