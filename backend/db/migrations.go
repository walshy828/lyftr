package db

import "log"

func migrate() error {
	_, err := DB.Exec(schema)
	return err
}

// alterMigrations adds columns/tables that postdate the initial schema.
// Each operation is idempotent: it checks before altering.
func alterMigrations() {
	rows, err := DB.Query("PRAGMA table_info(food_logs)")
	if err == nil {
		hasFiber, hasImageURL := false, false
		for rows.Next() {
			var cid int
			var name, typ string
			var notnull int
			var dflt interface{}
			var pk int
			if err := rows.Scan(&cid, &name, &typ, &notnull, &dflt, &pk); err != nil {
				log.Printf("migrations: scan error: %v", err)
				continue
			}
			if name == "fiber" {
				hasFiber = true
			}
			if name == "image_url" {
				hasImageURL = true
			}
		}
		rows.Close()
		if !hasFiber {
			if _, err := DB.Exec(`ALTER TABLE food_logs ADD COLUMN fiber REAL NOT NULL DEFAULT 0`); err != nil {
				log.Fatalf("alter food_logs add fiber: %v", err)
			}
			log.Println("migration: added food_logs.fiber")
		}
		if !hasImageURL {
			if _, err := DB.Exec(`ALTER TABLE food_logs ADD COLUMN image_url TEXT NOT NULL DEFAULT ''`); err != nil {
				log.Fatalf("alter food_logs add image_url: %v", err)
			}
			log.Println("migration: added food_logs.image_url")
		}
	}

	// Per-exercise rest timer (#33). Existing rows seed to 90s (on); 0 = off.
	ensureColumn("program_exercises", "rest_seconds", `ALTER TABLE program_exercises ADD COLUMN rest_seconds INTEGER NOT NULL DEFAULT 90`)
	ensureColumn("workout_exercises", "rest_seconds", `ALTER TABLE workout_exercises ADD COLUMN rest_seconds INTEGER NOT NULL DEFAULT 90`)

	// Manual entry / nutrition-label photo import. source distinguishes how a
	// food_logs row was created ("off" | "saved" | "manual" | "photo"); existing
	// rows default to '' since their real origin isn't recoverable.
	ensureColumn("food_logs", "source", `ALTER TABLE food_logs ADD COLUMN source TEXT NOT NULL DEFAULT ''`)
	ensureColumn("food_logs", "sugar", `ALTER TABLE food_logs ADD COLUMN sugar REAL NOT NULL DEFAULT 0`)
	ensureColumn("food_logs", "sodium", `ALTER TABLE food_logs ADD COLUMN sodium REAL NOT NULL DEFAULT 0`)
	ensureColumn("food_logs", "brand", `ALTER TABLE food_logs ADD COLUMN brand TEXT NOT NULL DEFAULT ''`)

	// Food photos for saved foods (#savedFoodPhoto)
	ensureColumn("saved_foods", "image_url", `ALTER TABLE saved_foods ADD COLUMN image_url TEXT NOT NULL DEFAULT ''`)

	// Broadcast program sharing (#shareProgram). is_shared=1 makes a program
	// readable by any authenticated user, not just its owner.
	ensureColumn("programs", "is_shared", `ALTER TABLE programs ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0`)
	if _, err := DB.Exec(`CREATE INDEX IF NOT EXISTS idx_programs_shared ON programs(is_shared) WHERE is_shared = 1`); err != nil {
		log.Fatalf("create idx_programs_shared: %v", err)
	}

	// Cholesterol tracking + closing the sugar/sodium gap on saved foods, plus
	// daily cholesterol/sodium targets. Defaults mirror common AHA/FDA daily
	// guideline values, matching the other targets' seed values.
	ensureColumn("food_logs", "cholesterol", `ALTER TABLE food_logs ADD COLUMN cholesterol REAL NOT NULL DEFAULT 0`)
	ensureColumn("saved_foods", "sugar", `ALTER TABLE saved_foods ADD COLUMN sugar REAL NOT NULL DEFAULT 0`)
	ensureColumn("saved_foods", "sodium", `ALTER TABLE saved_foods ADD COLUMN sodium REAL NOT NULL DEFAULT 0`)
	ensureColumn("saved_foods", "cholesterol", `ALTER TABLE saved_foods ADD COLUMN cholesterol REAL NOT NULL DEFAULT 0`)
	ensureColumn("user_settings", "cholesterol_target", `ALTER TABLE user_settings ADD COLUMN cholesterol_target INTEGER NOT NULL DEFAULT 300`)
	ensureColumn("user_settings", "sodium_target", `ALTER TABLE user_settings ADD COLUMN sodium_target INTEGER NOT NULL DEFAULT 2300`)

	// Food preferences for the AI meal recommender (#mealRecommend): free-text
	// comma lists fed into the recommendation prompt. Allergies are treated as
	// a hard exclusion, dislikes/likes as soft taste signals.
	ensureColumn("user_settings", "food_allergies", `ALTER TABLE user_settings ADD COLUMN food_allergies TEXT NOT NULL DEFAULT ''`)
	ensureColumn("user_settings", "food_dislikes", `ALTER TABLE user_settings ADD COLUMN food_dislikes TEXT NOT NULL DEFAULT ''`)
	ensureColumn("user_settings", "food_likes", `ALTER TABLE user_settings ADD COLUMN food_likes TEXT NOT NULL DEFAULT ''`)

	// Link workouts back to the program they were started from (#programSort),
	// so program lists can be sorted by last-used date. Nullable: existing
	// workouts and quick-start workouts have no program.
	ensureColumn("workouts", "program_id", `ALTER TABLE workouts ADD COLUMN program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL`)
	if _, err := DB.Exec(`CREATE INDEX IF NOT EXISTS idx_workouts_program ON workouts(program_id)`); err != nil {
		log.Fatalf("create idx_workouts_program: %v", err)
	}

	// Post-workout "how did that feel" rating (#workoutFeeling): 0=unrated
	// (all pre-existing workouts and clients that don't send it), 1=light,
	// 2=moderate, 3=intense.
	ensureColumn("workouts", "feeling", `ALTER TABLE workouts ADD COLUMN feeling INTEGER NOT NULL DEFAULT 0`)

	// Per-set completion, so a saved workout can distinguish a genuinely
	// completed set from one left at its target values by an early finish
	// (watch or web). Default 1 (true): every pre-existing row, and any
	// client that doesn't send this field, reads as completed — matching
	// what was implicitly assumed before this column existed.
	ensureColumn("sets", "completed", `ALTER TABLE sets ADD COLUMN completed INTEGER NOT NULL DEFAULT 1`)

	// Child-table lookup indexes: every workout/program load fetches children
	// by these foreign keys (and the exercise PR/history analytics join
	// through workout_exercises.exercise_id) — without them each lookup is a
	// full scan of tables that only ever grow.
	childIndexes := `
CREATE INDEX IF NOT EXISTS idx_workout_exercises_workout ON workout_exercises(workout_id);
CREATE INDEX IF NOT EXISTS idx_workout_exercises_exercise ON workout_exercises(exercise_id);
CREATE INDEX IF NOT EXISTS idx_sets_workout_exercise ON sets(workout_exercise_id);
CREATE INDEX IF NOT EXISTS idx_program_exercises_program ON program_exercises(program_id);
CREATE INDEX IF NOT EXISTS idx_program_sets_program_exercise ON program_sets(program_exercise_id);`
	if _, err := DB.Exec(childIndexes); err != nil {
		log.Fatalf("create child-table indexes: %v", err)
	}
}

// ensureColumn adds a column to a table if it's missing — idempotent on every boot.
func ensureColumn(table, column, alterSQL string) {
	rows, err := DB.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return
	}
	has := false
	for rows.Next() {
		var cid int
		var name, typ string
		var notnull int
		var dflt interface{}
		var pk int
		if err := rows.Scan(&cid, &name, &typ, &notnull, &dflt, &pk); err != nil {
			continue
		}
		if name == column {
			has = true
		}
	}
	rows.Close()
	if !has {
		if _, err := DB.Exec(alterSQL); err != nil {
			log.Fatalf("alter %s add %s: %v", table, column, err)
		}
		log.Printf("migration: added %s.%s", table, column)
	}
}

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  weight_unit    TEXT    NOT NULL DEFAULT 'lbs',
  calorie_target INTEGER NOT NULL DEFAULT 2000,
  protein_target INTEGER NOT NULL DEFAULT 150,
  carb_target    INTEGER NOT NULL DEFAULT 250,
  fat_target     INTEGER NOT NULL DEFAULT 65
);

CREATE TABLE IF NOT EXISTS exercises (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  muscle_group      TEXT NOT NULL DEFAULT '',
  secondary_muscles TEXT NOT NULL DEFAULT '[]', -- JSON array
  category          TEXT NOT NULL DEFAULT 'strength',
  equipment         TEXT NOT NULL DEFAULT '',
  description       TEXT NOT NULL DEFAULT '',
  image_url         TEXT NOT NULL DEFAULT '',
  video_url         TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_exercises_name ON exercises(name);

CREATE TABLE IF NOT EXISTS workouts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  notes      TEXT    NOT NULL DEFAULT '',
  duration   INTEGER NOT NULL DEFAULT 0,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workouts_user ON workouts(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS workout_exercises (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_id  INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id),
  order_index INTEGER NOT NULL DEFAULT 0,
  notes       TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sets (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_exercise_id INTEGER NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
  set_number          INTEGER NOT NULL DEFAULT 1,
  reps                INTEGER NOT NULL DEFAULT 0,
  weight              REAL    NOT NULL DEFAULT 0,
  duration            INTEGER NOT NULL DEFAULT 0,
  distance            REAL    NOT NULL DEFAULT 0,
  rpe                 REAL    NOT NULL DEFAULT 0,
  is_warmup           INTEGER NOT NULL DEFAULT 0,
  completed           INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS weight_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weight     REAL    NOT NULL,
  notes      TEXT    NOT NULL DEFAULT '',
  logged_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_weight_logs_user ON weight_logs(user_id, logged_at DESC);

CREATE TABLE IF NOT EXISTS food_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,
  brand        TEXT    NOT NULL DEFAULT '',
  meal         TEXT    NOT NULL DEFAULT 'snacks',
  calories     REAL    NOT NULL DEFAULT 0,
  protein      REAL    NOT NULL DEFAULT 0,
  carbs        REAL    NOT NULL DEFAULT 0,
  fat          REAL    NOT NULL DEFAULT 0,
  servings     REAL    NOT NULL DEFAULT 1,
  serving_size TEXT    NOT NULL DEFAULT '',
  barcode      TEXT    NOT NULL DEFAULT '',
  logged_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_food_logs_user ON food_logs(user_id, logged_at DESC);

CREATE TABLE IF NOT EXISTS saved_foods (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,
  brand        TEXT    NOT NULL DEFAULT '',
  calories     REAL    NOT NULL DEFAULT 0,
  protein      REAL    NOT NULL DEFAULT 0,
  carbs        REAL    NOT NULL DEFAULT 0,
  fat          REAL    NOT NULL DEFAULT 0,
  fiber        REAL    NOT NULL DEFAULT 0,
  serving_size TEXT    NOT NULL DEFAULT '',
  barcode      TEXT    NOT NULL DEFAULT '',
  image_url    TEXT    NOT NULL DEFAULT '',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_saved_foods_user ON saved_foods(user_id);

CREATE TABLE IF NOT EXISTS active_sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  data       TEXT    NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS programs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  notes      TEXT    NOT NULL DEFAULT '',
  is_shared  INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_programs_user ON programs(user_id);

CREATE TABLE IF NOT EXISTS program_exercises (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id  INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id),
  order_index INTEGER NOT NULL DEFAULT 0,
  notes       TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS program_sets (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  program_exercise_id INTEGER NOT NULL REFERENCES program_exercises(id) ON DELETE CASCADE,
  set_number          INTEGER NOT NULL DEFAULT 1,
  target_reps         INTEGER NOT NULL DEFAULT 0,
  target_weight       REAL    NOT NULL DEFAULT 0
);
`
