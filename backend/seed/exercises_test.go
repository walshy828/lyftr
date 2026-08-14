package seed

import (
	"database/sql"
	"fmt"
	"math/rand"
	"testing"

	"github.com/Cawlumm/lyftr-backend/config"
	_ "modernc.org/sqlite"
)

// testDB opens an in-memory SQLite DB with just the tables this package's
// tests touch: exercises, plus the two referencing tables pruneUnreferenced's
// guard queries against.
func testDB(t *testing.T) *sql.DB {
	t.Helper()
	dsn := fmt.Sprintf("file:seedtest_%d?mode=memory&cache=shared&_pragma=foreign_keys(on)", rand.Int63())
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	schema := `
CREATE TABLE exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  muscle_group TEXT NOT NULL DEFAULT '',
  secondary_muscles TEXT NOT NULL DEFAULT '[]',
  category TEXT NOT NULL DEFAULT 'strength',
  equipment TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  video_url TEXT NOT NULL DEFAULT '',
  image_url_end TEXT NOT NULL DEFAULT '',
  gif_url TEXT NOT NULL DEFAULT '',
  "force" TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT '',
  mechanic TEXT NOT NULL DEFAULT '',
  source_id TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX idx_exercises_name ON exercises(name);
CREATE TABLE workouts (id INTEGER PRIMARY KEY AUTOINCREMENT);
CREATE TABLE workout_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_id INTEGER NOT NULL REFERENCES workouts(id),
  exercise_id INTEGER NOT NULL REFERENCES exercises(id)
);
CREATE TABLE programs (id INTEGER PRIMARY KEY AUTOINCREMENT);
CREATE TABLE program_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id INTEGER NOT NULL REFERENCES programs(id),
  exercise_id INTEGER NOT NULL REFERENCES exercises(id)
);`
	if _, err := db.Exec(schema); err != nil {
		t.Fatalf("apply schema: %v", err)
	}
	return db
}

func TestSeedLyftrCardio_insertsSixExercises(t *testing.T) {
	db := testDB(t)
	if err := seedLyftrCardio(db); err != nil {
		t.Fatalf("seedLyftrCardio: %v", err)
	}
	var count int
	db.QueryRow(`SELECT COUNT(*) FROM exercises WHERE source = 'lyftr'`).Scan(&count)
	if count != len(lyftrCardioItems) {
		t.Fatalf("expected %d lyftr exercises, got %d", len(lyftrCardioItems), count)
	}
	for _, want := range []string{"Walk", "Run", "Bike", "Swim"} {
		var got string
		if err := db.QueryRow(`SELECT category FROM exercises WHERE name = ?`, want).Scan(&got); err != nil {
			t.Fatalf("exercise %q missing: %v", want, err)
		}
		if got != "cardio" {
			t.Errorf("%q: expected category cardio, got %q", want, got)
		}
	}
}

// TestPruneUnreferenced_survivesLyftrCardio is the regression test for the
// fix this migration feature depends on: a library-switch reset must never
// delete the native cardio carve-out, referenced or not, since
// QuickCardioModal needs it to resolve walk/run/bike/swim regardless of
// which third-party library is active.
func TestPruneUnreferenced_survivesLyftrCardio(t *testing.T) {
	db := testDB(t)
	if err := seedLyftrCardio(db); err != nil {
		t.Fatalf("seedLyftrCardio: %v", err)
	}

	// An unreferenced, non-lyftr exercise should be pruned...
	db.Exec(`INSERT INTO exercises (name, source) VALUES ('Stale Free Exercise', 'free')`)
	// ...but a referenced one should survive regardless of source.
	res, _ := db.Exec(`INSERT INTO exercises (name, source) VALUES ('Referenced Free Exercise', 'free')`)
	refID, _ := res.LastInsertId()
	db.Exec(`INSERT INTO workouts (id) VALUES (1)`)
	db.Exec(`INSERT INTO workout_exercises (workout_id, exercise_id) VALUES (1, ?)`, refID)

	if err := pruneUnreferenced(db); err != nil {
		t.Fatalf("pruneUnreferenced: %v", err)
	}

	var lyftrCount int
	db.QueryRow(`SELECT COUNT(*) FROM exercises WHERE source = 'lyftr'`).Scan(&lyftrCount)
	if lyftrCount != len(lyftrCardioItems) {
		t.Errorf("expected all %d lyftr exercises to survive prune, got %d", len(lyftrCardioItems), lyftrCount)
	}

	var staleCount int
	db.QueryRow(`SELECT COUNT(*) FROM exercises WHERE name = 'Stale Free Exercise'`).Scan(&staleCount)
	if staleCount != 0 {
		t.Errorf("expected unreferenced free exercise to be pruned, still found %d", staleCount)
	}

	var refCount int
	db.QueryRow(`SELECT COUNT(*) FROM exercises WHERE name = 'Referenced Free Exercise'`).Scan(&refCount)
	if refCount != 1 {
		t.Errorf("expected referenced free exercise to survive prune, found %d", refCount)
	}
}

func TestFetchAll_usesBySourceHook(t *testing.T) {
	orig := FetchBySourceHook
	t.Cleanup(func() { FetchBySourceHook = orig })

	var gotSource string
	FetchBySourceHook = func(source string) ([]SeedItem, error) {
		gotSource = source
		return []SeedItem{{Name: "Stub Exercise", Source: source}}, nil
	}

	prevConfig := config.C
	config.C = &config.Config{ExerciseLibrarySource: "gymvisual"}
	t.Cleanup(func() { config.C = prevConfig })

	items, err := fetchAll()
	if err != nil {
		t.Fatalf("fetchAll: %v", err)
	}
	if gotSource != "gymvisual" {
		t.Errorf("expected fetchAll to route through the hook with source %q, got %q", "gymvisual", gotSource)
	}
	if len(items) != 1 || items[0].Name != "Stub Exercise" {
		t.Errorf("expected the stubbed item back, got %+v", items)
	}
}
