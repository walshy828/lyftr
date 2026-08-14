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
	// "gymvisual" library source (see config.ExerciseLibrarySource). Its media
	// is copyrighted by Gymvisual, not covered by that repo's own license —
	// see the comment on config.ExerciseLibrarySource.
	gymvisualDatasetURL   = "https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/data/exercises.json"
	gymvisualMediaBaseURL = "https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/"

	// SourceFree, SourceGymvisual, SourceLyftr are the values of
	// exercises.source / models.Exercise.Source. SourceLyftr rows are the
	// always-present cardio carve-out (see seedLyftrCardio) — never fetched,
	// never pruned by a library switch.
	SourceFree      = "free"
	SourceGymvisual = "gymvisual"
	SourceLyftr     = "lyftr"
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

// SeedItem is the common shape both upstream datasets are normalized into
// before the upsert, so fetchAndStoreLocked doesn't need to know which
// source produced a given row.
type SeedItem struct {
	Name                             string
	MuscleGroup                      string
	SecondaryMuscles                 []string
	Category, Equipment, Description string
	ImageURL, ImageEndURL, GifURL    string
	Force, Level, Mechanic, SourceID string
	Source                           string
}

// CatalogItem is the trimmed shape the exercise-migration flow needs to build
// an AI-matching prompt (see vision.MatchExercisesRequest) — just enough to
// describe an exercise, without the media/taxonomy fields that don't help a
// name/muscle/equipment match.
type CatalogItem struct {
	Name, MuscleGroup, Equipment, Category string
}

// FetchCatalog pulls and normalizes one upstream dataset WITHOUT writing it to
// the database, for the exercise-migration preview: the target library isn't
// seeded yet at that point (see controllers/exercise_migration.go), so the AI
// match has to be run against a live fetch rather than the exercises table.
func FetchCatalog(source string) ([]CatalogItem, error) {
	var items []SeedItem
	var err error
	switch source {
	case SourceGymvisual:
		items, err = fetchGymvisual()
	case SourceFree:
		items, err = fetchFreeExerciseDB()
	default:
		return nil, fmt.Errorf("unknown exercise library source %q", source)
	}
	if err != nil {
		return nil, err
	}
	out := make([]CatalogItem, len(items))
	for i, it := range items {
		out[i] = CatalogItem{Name: it.Name, MuscleGroup: it.MuscleGroup, Equipment: it.Equipment, Category: it.Category}
	}
	return out, nil
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

	// A library seeded before source_id / image_url_end / source existed has
	// the rows but not the data, and the columns only fill in on a sync.
	// Without this, adding a column to the seed silently degrades every
	// existing install until somebody finds the admin sync button — which is
	// not a migration, it's a support ticket. The upsert is keyed on name, so
	// this refreshes in place and never duplicates.
	var stale int
	db.QueryRow(`SELECT COUNT(*) FROM exercises WHERE source_id = '' OR source = ''`).Scan(&stale)
	if stale > 0 {
		log.Printf("seed: %d/%d exercises predate the current schema - backfilling in background...", stale, count)
		go fetchAndStoreAsync(db)
		return
	}

	if err := seedLyftrCardio(db); err != nil {
		log.Printf("seed: lyftr cardio carve-out failed: %v", err)
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
	if err := pruneUnreferenced(db); err != nil {
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

// pruneUnreferenced deletes exercises that no saved workout/program
// references and that aren't part of the lyftr-native carve-out. With
// foreign_keys enforced, deleting a referenced row is (correctly) rejected —
// referenced rows are refreshed in place by the ON CONFLICT(name) upsert
// instead. source != 'lyftr' is belt-and-suspenders alongside "unreferenced":
// the cardio carve-out (seedLyftrCardio) must survive a reset even if
// briefly unused. Shared by WipeAndReseed and RepointAndPrune-adjacent
// callers that need the exact same guard (see stores.ExerciseMigrationStore.
// RepointAndPrune, which scopes it further to one source).
func pruneUnreferenced(db *sql.DB) error {
	_, err := db.Exec(`DELETE FROM exercises
		WHERE source != 'lyftr'
		  AND id NOT IN (SELECT exercise_id FROM workout_exercises)
		  AND id NOT IN (SELECT exercise_id FROM program_exercises)`)
	return err
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

	if err := upsertItems(tx, items); err != nil {
		tx.Rollback()
		return err
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	log.Printf("seed: synced %d exercises", len(items))

	if err := seedLyftrCardio(db); err != nil {
		log.Printf("seed: lyftr cardio carve-out failed: %v", err)
	}
	return nil
}

const upsertSQL = `
	INSERT INTO exercises (name, muscle_group, secondary_muscles, category, equipment, description,
	                       image_url, image_url_end, gif_url, "force", level, mechanic, source_id, source)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
	  source_id         = excluded.source_id,
	  source            = excluded.source
`

// upsertItems runs the shared insert-or-refresh against an open transaction.
// Used both by fetchAndStoreLocked (the ~870-1300 row upstream sync) and
// seedLyftrCardio (the fixed 6-row native carve-out) so the two never drift
// on column list or conflict handling.
func upsertItems(tx *sql.Tx, items []SeedItem) error {
	stmt, err := tx.Prepare(upsertSQL)
	if err != nil {
		return err
	}
	defer stmt.Close()

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
			e.Source,
		); err != nil {
			log.Printf("seed: skip %q: %v", e.Name, err)
			continue
		}
	}
	return nil
}

// lyftrCardioItems is the fixed, hardcoded set of always-present cardio
// exercises (see SourceLyftr). Unlike the upstream datasets, these are never
// fetched over the network and never pruned by WipeAndReseed — quick-cardio
// logging (QuickCardioModal) needs walk/run/bike/swim to resolve reliably
// regardless of which third-party library is active, and neither upstream
// dataset covers all four (Gymvisual in particular has no outdoor walk/bike
// and no swim at all — see the exercise-migration design notes). No
// image/gif: QuickCardioModal doesn't render exercise media today.
var lyftrCardioItems = []SeedItem{
	{Name: "Walk", MuscleGroup: "legs", Category: "cardio", Equipment: "none", SourceID: "lyftr-walk", Source: SourceLyftr, Description: "Walking at a steady pace, outdoors or on a treadmill."},
	{Name: "Run", MuscleGroup: "legs", Category: "cardio", Equipment: "none", SourceID: "lyftr-run", Source: SourceLyftr, Description: "Running or jogging at any pace, outdoors or on a treadmill."},
	{Name: "Bike", MuscleGroup: "legs", Category: "cardio", Equipment: "bicycle", SourceID: "lyftr-bike", Source: SourceLyftr, Description: "Cycling, outdoors or stationary."},
	{Name: "Swim", MuscleGroup: "full body", Category: "cardio", Equipment: "none", SourceID: "lyftr-swim", Source: SourceLyftr, Description: "Swimming laps, any stroke."},
	{Name: "Row", MuscleGroup: "back", Category: "cardio", Equipment: "rowing machine", SourceID: "lyftr-row", Source: SourceLyftr, Description: "Rowing machine cardio."},
	{Name: "Elliptical", MuscleGroup: "legs", Category: "cardio", Equipment: "elliptical machine", SourceID: "lyftr-elliptical", Source: SourceLyftr, Description: "Elliptical trainer cardio."},
}

// seedLyftrCardio upserts the native cardio carve-out. Cheap (6 rows, no
// network), so it's safe to call synchronously from every path that touches
// the exercise table, making it self-healing if the carve-out was ever
// missing (e.g. a DB created before this feature existed).
func seedLyftrCardio(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	if err := upsertItems(tx, lyftrCardioItems); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

// fetchAll picks the upstream dataset based on config.C.ExerciseLibrarySource
// and normalizes it into the common SeedItem shape.
func fetchAll() ([]SeedItem, error) {
	source := SourceFree
	if config.C != nil && config.C.ExerciseLibrarySource != "" {
		source = config.C.ExerciseLibrarySource
	}
	return FetchBySourceHook(source)
}

func fetchBySource(source string) ([]SeedItem, error) {
	if source == SourceGymvisual {
		return fetchGymvisual()
	}
	return fetchFreeExerciseDB()
}

// FetchBySourceHook is the seam fetchAll and SyncInto call through instead of
// fetchBySource directly, so tests (in this package or callers like
// controllers/exercise_migration_test.go) can replace it with a canned
// response instead of hitting the real upstream datasets over the network.
// Production code must never reassign this.
var FetchBySourceHook = fetchBySource

// FetchCatalogHook is the equivalent seam for FetchCatalog, used by the
// exercise-migration preview (controllers/exercise_migration.go) to build the
// AI-matching prompt's target catalog before that library is seeded.
var FetchCatalogHook = FetchCatalog

// SyncInto seeds `source` into the database without touching or pruning any
// other library's rows — used by the exercise-migration confirm flow to add
// the target library alongside the one still in use, before the migration's
// own RepointAndPrune (stores/exercise_migration.go) removes the old one.
// Bypasses config.ExerciseLibrarySource entirely; the caller picks the
// source explicitly. Shares the seeding guard with the other sync paths, so
// it can't race a concurrent admin sync/reset/first-run seed.
func SyncInto(db *sql.DB, source string) error {
	if !seeding.CompareAndSwap(false, true) {
		return fmt.Errorf("seed already in progress")
	}
	defer seeding.Store(false)

	items, err := FetchBySourceHook(source)
	if err != nil {
		return err
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	if err := upsertItems(tx, items); err != nil {
		tx.Rollback()
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	log.Printf("seed: synced %d exercises into %q", len(items), source)
	return seedLyftrCardio(db)
}

func fetchFreeExerciseDB() ([]SeedItem, error) {
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

	items := make([]SeedItem, 0, len(raw))
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

		items = append(items, SeedItem{
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
			Source:           SourceFree,
		})
	}
	return items, nil
}

// fetchGymvisual pulls the optional Gymvisual-sourced dataset (see
// config.ExerciseLibrarySource) and normalizes it. That dataset has no
// force/level/mechanic taxonomy, so those filter chips simply won't appear
// for rows seeded from it — the facets endpoint already skips empty values.
func fetchGymvisual() ([]SeedItem, error) {
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

	items := make([]SeedItem, 0, len(raw))
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

		items = append(items, SeedItem{
			Name:             e.Name,
			MuscleGroup:      e.Target,
			SecondaryMuscles: secondary,
			Category:         e.Category,
			Equipment:        e.Equipment,
			Description:      e.Instructions["en"],
			ImageURL:         imageURL,
			GifURL:           gifURL,
			SourceID:         sourceID,
			Source:           SourceGymvisual,
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
