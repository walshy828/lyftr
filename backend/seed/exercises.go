package seed

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/Cawlumm/lyftr-backend/config"
)

const (
	exerciseDBURL = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json"
	// ImageBaseURL is exported because the on-disk image cache fetches from the
	// same origin; duplicating the string would let the two drift apart.
	ImageBaseURL = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises"

	// gymvisualDatasetURL and gymvisualMediaBaseURL back the optional
	// EXERCISE_GIF_SOURCE dataset (see config.ExerciseGifSource). Its media is
	// copyrighted by Gymvisual, not covered by that repo's own license — see
	// the comment on config.ExerciseGifSource.
	gymvisualDatasetURL   = "https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/data/exercises.json"
	gymvisualMediaBaseURL = "https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/"
)

var seeding atomic.Bool

type freeExerciseItem struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Force            string   `json:"force"`
	Level            string   `json:"level"`
	Mechanic         string   `json:"mechanic"`
	Equipment        string   `json:"equipment"`
	PrimaryMuscles   []string `json:"primaryMuscles"`
	SecondaryMuscles []string `json:"secondaryMuscles"`
	Instructions     []string `json:"instructions"`
	Category         string   `json:"category"`
	Images           []string `json:"images"`
}

// gymvisualItem mirrors the subset of hasaneyldrm/exercises-dataset's schema
// (data/exercises.schema.json) that the seed actually uses. Instructions are
// keyed by language; only English is consumed.
type gymvisualItem struct {
	ID               string            `json:"id"`
	Name             string            `json:"name"`
	Category         string            `json:"category"`
	BodyPart         string            `json:"body_part"`
	Equipment        string            `json:"equipment"`
	Instructions     map[string]string `json:"instructions"`
	MuscleGroup      string            `json:"muscle_group"`
	SecondaryMuscles []string          `json:"secondary_muscles"`
	Target           string            `json:"target"`
	MediaID          string            `json:"media_id"`
	Image            string            `json:"image"`
	GifURL           string            `json:"gif_url"`
}

// seedItem is the common shape both upstream datasets are normalized into
// before the upsert, so fetchAndStoreLocked doesn't need to know which
// source produced a given row.
type seedItem struct {
	Name                             string
	MuscleGroup                      string
	SecondaryMuscles                 []string
	Category, Equipment, Description string
	ImageURL, ImageEndURL, GifURL    string
	Force, Level, Mechanic, SourceID string
}

// SeedStatus returns current exercise count and whether a seed is running.
type SeedStatus struct {
	Count      int  `json:"count"`
	InProgress bool `json:"in_progress"`
}

func GetSeedStatus(db *sql.DB) SeedStatus {
	var count int
	db.QueryRow(`SELECT COUNT(*) FROM exercises`).Scan(&count)
	return SeedStatus{Count: count, InProgress: seeding.Load()}
}

// Exercises seeds on first run if the table is empty, and backfills a library
// that predates a column the seed now populates. Both run in the background so
// startup isn't blocked on a network fetch.
func Exercises(db *sql.DB) {
	var count int
	db.QueryRow(`SELECT COUNT(*) FROM exercises`).Scan(&count)
	if count == 0 {
		log.Println("seed: exercises table empty - syncing in background...")
		go fetchAndStoreAsync(db)
		return
	}

	// A library seeded before source_id / image_url_end existed has the rows but
	// not the data, and the columns only fill in on a sync. Without this, adding
	// a column to the seed silently degrades every existing install until
	// somebody finds the admin sync button — which is not a migration, it's a
	// support ticket. The upsert is keyed on name, so this refreshes in place
	// and never duplicates.
	var stale int
	db.QueryRow(`SELECT COUNT(*) FROM exercises WHERE source_id = ''`).Scan(&stale)
	if stale > 0 {
		log.Printf("seed: %d/%d exercises predate the current schema - backfilling in background...", stale, count)
		go fetchAndStoreAsync(db)
		return
	}

	log.Printf("seed: %d exercises already in database, skipping sync", count)
}

func fetchAndStoreAsync(db *sql.DB) {
	if err := fetchAndStore(db); err != nil {
		log.Printf("seed: exercise sync failed: %v", err)
		return
	}
}

// SyncExercises forces a full re-sync (used by admin endpoint).
func SyncExercises(db *sql.DB) error {
	return fetchAndStore(db)
}

// WipeAndReseed deletes all exercises then re-fetches from source.
func WipeAndReseed(db *sql.DB) error {
	// Claim the flag atomically BEFORE wiping: a Load-then-act check races —
	// two concurrent calls could both pass it, double-wipe, and seed twice.
	if !seeding.CompareAndSwap(false, true) {
		return fmt.Errorf("seed already in progress")
	}
	// Prune only unreferenced exercises: with foreign_keys enforced, deleting an
	// exercise that a saved workout/program references is (correctly) rejected.
	// Referenced rows are refreshed in place by the ON CONFLICT(name) upsert below.
	if _, err := db.Exec(`DELETE FROM exercises
		WHERE id NOT IN (SELECT exercise_id FROM workout_exercises)
		  AND id NOT IN (SELECT exercise_id FROM program_exercises)`); err != nil {
		seeding.Store(false)
		return fmt.Errorf("wipe failed: %w", err)
	}
	log.Println("seed: exercises wiped, starting re-seed...")
	go func() {
		defer seeding.Store(false)
		if err := fetchAndStoreLocked(db); err != nil {
			log.Printf("seed: exercise sync failed: %v", err)
		}
	}()
	return nil
}

// fetchAndStore claims the seeding flag for the duration of the sync.
func fetchAndStore(db *sql.DB) error {
	if !seeding.CompareAndSwap(false, true) {
		return fmt.Errorf("seed already in progress")
	}
	defer seeding.Store(false)
	return fetchAndStoreLocked(db)
}

// fetchAndStoreLocked does the sync; the caller must hold the seeding flag.
func fetchAndStoreLocked(db *sql.DB) error {
	items, err := fetchAll()
	if err != nil {
		return err
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}

	stmt, err := tx.Prepare(`
		INSERT INTO exercises (name, muscle_group, secondary_muscles, category, equipment, description,
		                       image_url, image_url_end, gif_url, "force", level, mechanic, source_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(name) DO UPDATE SET
		  muscle_group      = excluded.muscle_group,
		  secondary_muscles = excluded.secondary_muscles,
		  category          = excluded.category,
		  equipment         = excluded.equipment,
		  description       = excluded.description,
		  image_url         = excluded.image_url,
		  image_url_end     = excluded.image_url_end,
		  gif_url           = excluded.gif_url,
		  "force"           = excluded."force",
		  level             = excluded.level,
		  mechanic          = excluded.mechanic,
		  source_id         = excluded.source_id
	`)
	if err != nil {
		tx.Rollback()
		return err
	}
	defer stmt.Close()

	inserted := 0
	for _, e := range items {
		secondaryJSON, _ := json.Marshal(e.SecondaryMuscles)
		if e.SecondaryMuscles == nil {
			secondaryJSON = []byte("[]")
		}

		if _, err := stmt.Exec(
			e.Name,
			e.MuscleGroup,
			string(secondaryJSON),
			e.Category,
			e.Equipment,
			e.Description,
			e.ImageURL,
			e.ImageEndURL,
			e.GifURL,
			e.Force,
			e.Level,
			e.Mechanic,
			e.SourceID,
		); err != nil {
			log.Printf("seed: skip %q: %v", e.Name, err)
			continue
		}
		inserted++
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	log.Printf("seed: synced %d exercises", inserted)
	return nil
}

// fetchAll picks the upstream dataset based on config.C.ExerciseGifSource and
// normalizes it into the common seedItem shape.
func fetchAll() ([]seedItem, error) {
	if config.C != nil && config.C.ExerciseGifSource {
		return fetchGymvisual()
	}
	return fetchFreeExerciseDB()
}

func fetchFreeExerciseDB() ([]seedItem, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(exerciseDBURL)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("fetch returned %d: %s", resp.StatusCode, string(body))
	}

	var raw []freeExerciseItem
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("decode failed: %w", err)
	}

	items := make([]seedItem, 0, len(raw))
	for _, e := range raw {
		primaryMuscle := ""
		if len(e.PrimaryMuscles) > 0 {
			primaryMuscle = e.PrimaryMuscles[0]
		}

		// Build both frames from the upstream paths rather than re-deriving
		// them from e.ID. The dataset's entries are already "<id>/<n>.jpg", so
		// using them directly survives any id/path mismatch upstream. Most
		// exercises ship two frames — the start and end of the movement — but
		// not all, hence the length guard.
		imageURL, imageEndURL := "", ""
		if len(e.Images) > 0 {
			imageURL = ImageBaseURL + "/" + e.Images[0]
		}
		if len(e.Images) > 1 {
			imageEndURL = ImageBaseURL + "/" + e.Images[1]
		}

		items = append(items, seedItem{
			Name:             e.Name,
			MuscleGroup:      primaryMuscle,
			SecondaryMuscles: e.SecondaryMuscles,
			Category:         e.Category,
			Equipment:        e.Equipment,
			Description:      buildInstructions(e.Instructions),
			ImageURL:         imageURL,
			ImageEndURL:      imageEndURL,
			Force:            e.Force,
			Level:            e.Level,
			Mechanic:         e.Mechanic,
			SourceID:         e.ID,
		})
	}
	return items, nil
}

// fetchGymvisual pulls the optional Gymvisual-sourced dataset (see
// config.ExerciseGifSource) and normalizes it. That dataset has no
// force/level/mechanic taxonomy, so those filter chips simply won't appear
// for rows seeded from it — the facets endpoint already skips empty values.
func fetchGymvisual() ([]seedItem, error) {
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Get(gymvisualDatasetURL)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("fetch returned %d: %s", resp.StatusCode, string(body))
	}

	var raw []gymvisualItem
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("decode failed: %w", err)
	}

	items := make([]seedItem, 0, len(raw))
	for _, e := range raw {
		// target is the dataset's "primary target muscle"; muscle_group is the
		// synergist the schema pairs it with. Lyftr's MuscleGroup column means
		// "primary", so target maps there and muscle_group folds into
		// secondary_muscles alongside the dataset's own secondary list.
		secondary := e.SecondaryMuscles
		if e.MuscleGroup != "" {
			secondary = append([]string{e.MuscleGroup}, secondary...)
		}

		// sourceID doubles as the on-disk cache key (storage.EnsureExerciseImage/
		// EnsureExerciseGif) and must match the dataset's own filename stem —
		// "images/0001-2gPfomN.jpg" / "videos/0001-2gPfomN.gif" — so frames can
		// be re-derived from it later without storing the id/media_id pair twice.
		sourceID := e.ID
		if e.MediaID != "" {
			sourceID = e.ID + "-" + e.MediaID
		}

		imageURL := ""
		if e.Image != "" {
			imageURL = gymvisualMediaBaseURL + e.Image
		}
		gifURL := ""
		if e.GifURL != "" {
			gifURL = gymvisualMediaBaseURL + e.GifURL
		}

		items = append(items, seedItem{
			Name:             e.Name,
			MuscleGroup:      e.Target,
			SecondaryMuscles: secondary,
			Category:         e.Category,
			Equipment:        e.Equipment,
			Description:      e.Instructions["en"],
			ImageURL:         imageURL,
			GifURL:           gifURL,
			SourceID:         sourceID,
		})
	}
	return items, nil
}

func buildInstructions(steps []string) string {
	var b strings.Builder
	for i, step := range steps {
		if i > 0 {
			b.WriteByte('\n')
		}
		fmt.Fprintf(&b, "%d. %s", i+1, step)
	}
	return b.String()
}
