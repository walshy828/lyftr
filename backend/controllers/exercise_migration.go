package controllers

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"time"

	"github.com/Cawlumm/lyftr-backend/config"
	"github.com/Cawlumm/lyftr-backend/middleware"
	"github.com/Cawlumm/lyftr-backend/seed"
	"github.com/Cawlumm/lyftr-backend/stores"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/Cawlumm/lyftr-backend/vision"
	"github.com/gin-gonic/gin"
)

// GetExerciseMigrationStatus returns the current library source and the most
// recent migration record (if any), so the Settings UI can render current
// state without a bespoke "current source" endpoint.
func (h *Handler) GetExerciseMigrationStatus(c *gin.Context) {
	latest, err := h.s.ExerciseMigration.LatestMigration()
	if err != nil && err != sql.ErrNoRows {
		utils.DBError(c, err)
		return
	}
	resp := gin.H{"current_source": config.C.ExerciseLibrarySource}
	if err != sql.ErrNoRows {
		resp["latest_migration"] = latest
	}
	utils.OK(c, resp)
}

// PreviewExerciseMigration computes (but does not apply) an AI-proposed
// mapping from the currently in-use exercises of one library onto the best
// matches in another. Pure read + AI call — never touches exercises,
// workout_exercises, or program_exercises, so it's safe to re-run.
func (h *Handler) PreviewExerciseMigration(c *gin.Context) {
	var req struct {
		ToSource string `json:"to_source" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if req.ToSource != seed.SourceFree && req.ToSource != seed.SourceGymvisual {
		utils.BadRequest(c, `to_source must be "free" or "gymvisual"`)
		return
	}
	fromSource := config.C.ExerciseLibrarySource
	if req.ToSource == fromSource {
		utils.BadRequest(c, "already on that library source")
		return
	}
	if h.vision == nil {
		utils.ServiceUnavailable(c, "exercise migration requires an AI provider (VISION_PROVIDER) to be configured")
		return
	}

	if latest, err := h.s.ExerciseMigration.LatestMigration(); err == nil && latest.Status == "proposed" {
		utils.Conflict(c, fmt.Sprintf("migration #%d is already proposed and awaiting confirm or a fresh preview", latest.ID))
		return
	}

	inUse, err := h.s.ExerciseMigration.InUseExercises(fromSource)
	if utils.DBError(c, err) {
		return
	}

	catalog, err := seed.FetchCatalogHook(req.ToSource)
	if err != nil {
		utils.ServiceUnavailable(c, "could not fetch the target exercise dataset: "+err.Error())
		return
	}

	mapping := make([]stores.MigrationMappingEntry, len(inUse))
	for i, e := range inUse {
		mapping[i] = stores.MigrationMappingEntry{OldExerciseID: e.ID, OldName: e.Name, Confidence: "low"}
	}

	if len(inUse) > 0 {
		refs := make([]vision.ExerciseRef, len(inUse))
		for i, e := range inUse {
			refs[i] = vision.ExerciseRef{ID: e.ID, Name: e.Name, MuscleGroup: e.MuscleGroup, Equipment: e.Equipment, Category: e.Category}
		}
		candidates := make([]vision.MatchCandidate, len(catalog))
		for i, item := range catalog {
			candidates[i] = vision.MatchCandidate{Name: item.Name, MuscleGroup: item.MuscleGroup, Equipment: item.Equipment, Category: item.Category}
		}

		// 90s: this prompt embeds the full in-use list plus a ~900-1300 row
		// target catalog, larger than GenerateProgram's already-generous 60s
		// budget (see programs.go) — same SDK deadline-propagation caveat
		// applies.
		ctx, cancel := context.WithTimeout(c.Request.Context(), 90*time.Second)
		defer cancel()

		matches, err := h.vision.MatchExercises(ctx, vision.MatchExercisesRequest{InUse: refs, Catalog: candidates})
		if err != nil {
			utils.ServiceUnavailable(c, "AI exercise matching failed: "+err.Error())
			return
		}

		byID := make(map[int64]vision.ExerciseMatch, len(matches))
		for _, m := range matches {
			byID[m.OldExerciseID] = m
		}
		for i, e := range mapping {
			if m, ok := byID[e.OldExerciseID]; ok {
				mapping[i].MatchedName = m.MatchedName
				mapping[i].Confidence = m.Confidence
				mapping[i].Reasoning = m.Reasoning
			}
		}
	}

	id, err := h.s.ExerciseMigration.SaveProposal(fromSource, req.ToSource, mapping)
	if utils.DBError(c, err) {
		return
	}
	record, err := h.s.ExerciseMigration.GetMigration(id)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, record)
}

// ConfirmExerciseMigration applies a (possibly hand-edited) mapping: seeds
// the target library alongside the current one, resolves each mapping
// entry's matched name to the newly-seeded exercise's id, repoints
// workout_exercises/program_exercises, prunes the old library, and flips the
// running process's active source. See stores.ExerciseMigrationStore.
// RepointAndPrune and config.ExerciseLibrarySource's doc comment for why the
// env var itself still needs a manual update to survive a restart.
func (h *Handler) ConfirmExerciseMigration(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid migration id")
		return
	}
	var req struct {
		Mapping []stores.MigrationMappingEntry `json:"mapping" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}

	record, err := h.s.ExerciseMigration.GetMigration(id)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "migration not found")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	if record.Status != "proposed" {
		utils.Conflict(c, fmt.Sprintf("migration #%d is already %s", record.ID, record.Status))
		return
	}

	// Every in-use exercise must be accounted for: matched-and-accepted or
	// explicitly left unmigrated. A row with neither is a caller bug (a gap
	// in the UI's resolution flow), and applying it would silently orphan
	// that exercise's history — reject instead of guessing.
	for _, m := range req.Mapping {
		if m.MatchedName == "" && !m.LeaveUnmigrated {
			utils.BadRequest(c, fmt.Sprintf("exercise %q has no match and was not marked leave_unmigrated", m.OldName))
			return
		}
	}

	// Step A: seed the target library alongside the current one (does not
	// delete anything — ON CONFLICT(name) never fires across datasets, see
	// config.ExerciseLibrarySource's doc comment, so this purely adds rows).
	if err := h.s.ExerciseMigration.SyncTargetLibrary(record.ToSource); err != nil {
		h.s.ExerciseMigration.MarkFailed(id, "seed target library: "+err.Error())
		utils.ServiceUnavailable(c, "could not seed the target exercise library: "+err.Error())
		return
	}

	// Step B: resolve each accepted match's name to the newly-seeded row's id.
	byOldID := make(map[int64]int64, len(req.Mapping))
	final := make([]stores.MigrationMappingEntry, len(req.Mapping))
	for i, m := range req.Mapping {
		final[i] = m
		if m.LeaveUnmigrated {
			continue
		}
		newID, err := h.s.ExerciseMigration.ExerciseIDByName(m.MatchedName, record.ToSource)
		if err != nil {
			h.s.ExerciseMigration.MarkFailed(id, fmt.Sprintf("resolve %q in %s: %v", m.MatchedName, record.ToSource, err))
			utils.BadRequest(c, fmt.Sprintf("matched exercise %q was not found in the %s library — it may have been renamed upstream; re-run preview", m.MatchedName, record.ToSource))
			return
		}
		final[i].NewExerciseID = newID
		byOldID[m.OldExerciseID] = newID
	}

	// Step C: repoint + prune, one transaction.
	if err := h.s.ExerciseMigration.RepointAndPrune(byOldID, record.FromSource); err != nil {
		h.s.ExerciseMigration.MarkFailed(id, "repoint and prune: "+err.Error())
		utils.DBError(c, err)
		return
	}

	appliedBy, _ := c.Get(middleware.UserEmailKey)
	appliedByStr, _ := appliedBy.(string)
	if err := h.s.ExerciseMigration.MarkApplied(id, appliedByStr, final); err != nil {
		utils.DBError(c, err)
		return
	}

	// Step D: flip the running process's active source. Does not persist
	// across a restart — see the doc comment on config.ExerciseLibrarySource.
	config.C.ExerciseLibrarySource = record.ToSource

	utils.OK(c, gin.H{
		"applied":     true,
		"from_source": record.FromSource,
		"to_source":   record.ToSource,
		"migrated":    len(byOldID),
		"message":     fmt.Sprintf("Migrated to %q. Set EXERCISE_LIBRARY_SOURCE=%s in your environment so this survives a restart.", record.ToSource, record.ToSource),
	})
}
