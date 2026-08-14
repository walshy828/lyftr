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
)

const (
	exerciseDBURL = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json"
	// ImageBaseURL is exported because the on-disk image cache fetches from the
	// same origin; duplicating the string would let the two drift apart.
	ImageBaseURL = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises"
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
		log.Println("seed: exercises table empty - syncing from free-exercise-db in background...")
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
		                       image_url, image_url_end, "force", level, mechanic, source_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(name) DO UPDATE SET
		  muscle_group      = excluded.muscle_group,
		  secondary_muscles = excluded.secondary_muscles,
		  category          = excluded.category,
		  equipment         = excluded.equipment,
		  description       = excluded.description,
		  image_url         = excluded.image_url,
		  image_url_end     = excluded.image_url_end,
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
		primaryMuscle := ""
		if len(e.PrimaryMuscles) > 0 {
			primaryMuscle = e.PrimaryMuscles[0]
		}

		secondaryJSON, _ := json.Marshal(e.SecondaryMuscles)
		if e.SecondaryMuscles == nil {
			secondaryJSON = []byte("[]")
		}

		instructions := buildInstructions(e.Instructions)

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

		if _, err := stmt.Exec(
			e.Name,
			primaryMuscle,
			string(secondaryJSON),
			e.Category,
			e.Equipment,
			instructions,
			imageURL,
			imageEndURL,
			e.Force,
			e.Level,
			e.Mechanic,
			e.ID,
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

func fetchAll() ([]freeExerciseItem, error) {
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

	var items []freeExerciseItem
	if err := json.NewDecoder(resp.Body).Decode(&items); err != nil {
		return nil, fmt.Errorf("decode failed: %w", err)
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
