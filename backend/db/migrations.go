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

	// Structured portions: the mass of one serving, so the client can offer an
	// amount + unit picker (1 tbsp, 30 g, 1.5 oz) instead of a bare servings
	// multiplier. 0 means unknown — existing rows keep the multiplier-only
	// behaviour, since their serving_size is free text we can't reliably parse.
	ensureColumn("food_logs", "serving_size_grams", `ALTER TABLE food_logs ADD COLUMN serving_size_grams REAL NOT NULL DEFAULT 0`)
	ensureColumn("saved_foods", "serving_size_grams", `ALTER TABLE saved_foods ADD COLUMN serving_size_grams REAL NOT NULL DEFAULT 0`)

	// The same for volume, so a drink logged as "1 cup" reopens on cups. A food
	// measured by volume has no mass basis at all — its panel states only ml —
	// so the gram column above cannot stand in for this one.
	ensureColumn("food_logs", "serving_size_ml", `ALTER TABLE food_logs ADD COLUMN serving_size_ml REAL NOT NULL DEFAULT 0`)
	ensureColumn("saved_foods", "serving_size_ml", `ALTER TABLE saved_foods ADD COLUMN serving_size_ml REAL NOT NULL DEFAULT 0`)

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

	// Personal access tokens (#mcpTokens): long-lived bearer tokens for
	// non-interactive clients (MCP server, scripts) that can't do an
	// interactive JWT login. token_prefix is stored in cleartext purely for
	// display ("lyftr_pat_AbCd12...") in the token list.
	if _, err := DB.Exec(`
CREATE TABLE IF NOT EXISTS personal_access_tokens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  token_prefix  TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at  DATETIME,
  expires_at    DATETIME,
  revoked_at    DATETIME
);
CREATE INDEX IF NOT EXISTS idx_pat_user ON personal_access_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_pat_hash ON personal_access_tokens(token_hash);`); err != nil {
		log.Fatalf("create personal_access_tokens: %v", err)
	}

	// Weight-loss plan (#weightPlan): demographic profile for BMR/BMI + AI plan
	// generation, an append-only nutrition-goal history (never UPDATEd — the
	// "current" goal is the latest row by effective_at), the AI-projected
	// weekly trajectory tied to the goal that produced it, and a weekly-cached
	// AI motivational note (at most one AI call per user per calendar week),
	// plus the persisted progress check-in reports (bounded history — the store
	// prunes to the newest few per user; a report is frozen once generated so
	// the narrative a user read yesterday doesn't silently change today).
	if _, err := DB.Exec(`
CREATE TABLE IF NOT EXISTS user_profile (
  user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  birth_date      TEXT    NOT NULL DEFAULT '',
  sex             TEXT    NOT NULL DEFAULT '',
  height_inches   REAL    NOT NULL DEFAULT 0,
  activity_level  TEXT    NOT NULL DEFAULT 'moderate'
);

CREATE TABLE IF NOT EXISTS nutrition_goals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  calorie_target  INTEGER NOT NULL,
  protein_target  INTEGER NOT NULL,
  carb_target     INTEGER NOT NULL,
  fat_target      INTEGER NOT NULL,
  target_weight   REAL    NOT NULL,
  source          TEXT    NOT NULL DEFAULT 'ai',
  notes           TEXT    NOT NULL DEFAULT '',
  effective_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_nutrition_goals_user ON nutrition_goals(user_id, effective_at DESC);

CREATE TABLE IF NOT EXISTS weight_plan_projections (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  nutrition_goal_id INTEGER NOT NULL REFERENCES nutrition_goals(id) ON DELETE CASCADE,
  week              INTEGER NOT NULL,
  expected_weight   REAL    NOT NULL,
  expected_date     DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_weight_plan_projections_goal ON weight_plan_projections(nutrition_goal_id, week);

CREATE TABLE IF NOT EXISTS motivation_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start DATE     NOT NULL,
  message    TEXT     NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_motivation_notes_user_week ON motivation_notes(user_id, week_start);

CREATE TABLE IF NOT EXISTS plan_checkins (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id    INTEGER NOT NULL REFERENCES nutrition_goals(id) ON DELETE CASCADE,
  facts      TEXT     NOT NULL,
  report     TEXT     NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_plan_checkins_user ON plan_checkins(user_id, created_at DESC);
`); err != nil {
		log.Fatalf("create weight-plan tables: %v", err)
	}

	// Blood pressure (#bloodPressure). Unlike weight_logs there is deliberately
	// no one-row-per-day constraint: AHA guidance is to take two or three
	// readings a minute apart, morning and evening, so multiple rows per day is
	// the expected shape rather than a duplicate to collapse.
	//
	// tz_offset records the client's UTC offset (minutes east) AT CAPTURE TIME.
	// "Morning reading" is a local-time concept, and logged_at alone can't answer
	// it — the weight endpoints widen date filters by ±12h precisely because they
	// have to guess. Storing the offset makes the capture-protocol rules ("no
	// morning readings this week") decidable server-side with no guessing.
	if _, err := DB.Exec(`
CREATE TABLE IF NOT EXISTS blood_pressure_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  systolic   INTEGER NOT NULL,
  diastolic  INTEGER NOT NULL,
  pulse      INTEGER NOT NULL DEFAULT 0,
  context    TEXT    NOT NULL DEFAULT '',
  arm        TEXT    NOT NULL DEFAULT '',
  position   TEXT    NOT NULL DEFAULT '',
  rested     INTEGER NOT NULL DEFAULT 0,
  notes      TEXT    NOT NULL DEFAULT '',
  tz_offset  INTEGER NOT NULL DEFAULT 0,
  logged_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bp_logs_user ON blood_pressure_logs(user_id, logged_at DESC);

CREATE TABLE IF NOT EXISTS bp_insights (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  facts      TEXT     NOT NULL,
  report     TEXT     NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bp_insights_user ON bp_insights(user_id, created_at DESC);`); err != nil {
		log.Fatalf("create blood_pressure_logs: %v", err)
	}

	// user_profile originally stored a static "age" column; replaced with
	// birth_date (#weightPlan) so age can be computed dynamically over time
	// instead of going stale. The CREATE TABLE above only applies to brand-new
	// databases — an existing user_profile table from before this change
	// needs birth_date added explicitly. The old age column, if present, is
	// simply left unused rather than dropped (SQLite DROP COLUMN support is
	// version-dependent, and an unused column is harmless).
	ensureColumn("user_profile", "birth_date", `ALTER TABLE user_profile ADD COLUMN birth_date TEXT NOT NULL DEFAULT ''`)

	// Cardio logging (walks/runs/rides) records step count alongside the
	// pre-existing duration/distance columns. The CREATE TABLE above only
	// applies to brand-new databases — an existing sets table needs the
	// column added explicitly.
	ensureColumn("sets", "steps", `ALTER TABLE sets ADD COLUMN steps INTEGER NOT NULL DEFAULT 0`)

	// Editable display name for the account (used in the greeting/UI in place of
	// the email). Existing databases predate the users.name column.
	ensureColumn("users", "name", `ALTER TABLE users ADD COLUMN name TEXT NOT NULL DEFAULT ''`)

	// Structured plan write-up (summary + headed bullet sections) as JSON,
	// alongside the pre-existing free-text notes column. notes is kept as the
	// flattened plain-text fallback so goals accepted before this change — and
	// any provider that returns only prose — still render.
	ensureColumn("nutrition_goals", "plan_detail", `ALTER TABLE nutrition_goals ADD COLUMN plan_detail TEXT NOT NULL DEFAULT ''`)

	// Remembered vantage point for the weight-plan progress view. '' means
	// "start from the journey start" (the first accepted goal's effective_at),
	// so a user who never picks a date always sees their whole history.
	ensureColumn("user_settings", "plan_history_start", `ALTER TABLE user_settings ADD COLUMN plan_history_start TEXT NOT NULL DEFAULT ''`)

	// Token revocation. Access/refresh tokens are stateless JWTs, so before
	// this there was no way to invalidate one: a stolen refresh token stayed
	// valid for its full lifetime and the only remedy was rotating JWT_SECRET,
	// which logs out every user. Two mechanisms, deliberately:
	//
	//   - token_version is a per-user epoch. Bumping it invalidates every
	//     token that user holds at once (password change, account deletion).
	//     One integer compare on the row we already have — no extra query.
	//   - revoked_tokens denies a single token by its jti (logout, refresh
	//     rotation) without disturbing the user's other sessions.
	//
	// Rows are pruned once expired — see stores.TokenStore.PurgeExpiredRevocations.
	ensureColumn("users", "token_version", `ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0`)
	revocation := `
CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti        TEXT     PRIMARY KEY,
  user_id    INTEGER  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens(expires_at);`
	if _, err := DB.Exec(revocation); err != nil {
		log.Fatalf("create revoked_tokens: %v", err)
	}

	// Per-user consent for sending health data to a third-party LLM. Defaults
	// to 0: the export is opt-in, never inherited from the operator merely
	// enabling a provider.
	ensureColumn("user_settings", "ai_health_insights_opt_in", `ALTER TABLE user_settings ADD COLUMN ai_health_insights_opt_in INTEGER NOT NULL DEFAULT 0`)

	// How long a device the user chose to remember stays signed in. Stored
	// per-user rather than as an operator-wide env var because the right answer
	// differs per device — a phone in your pocket and a shared laptop want
	// different numbers — and clamped server-side to MAX_SESSION_DAYS so the
	// setting cannot be used to mint an unbounded credential.
	ensureColumn("user_settings", "session_max_days", `ALTER TABLE user_settings ADD COLUMN session_max_days INTEGER NOT NULL DEFAULT 30`)

	// Whether the session UI asks for a per-set effort rating, and on which
	// scale: '' (off), 'rpe' (1-10 exertion) or 'rir' (reps left in reserve).
	//
	// Only the presentation differs — both store one number in sets.rpe, with
	// RIR converted as 10 - rir. Two columns would let the two representations
	// drift apart for the same set.
	//
	// Defaults to off. The sets.rpe column has existed (unused) since the
	// schema was written; turning capture on for everyone would put a control
	// in front of lifters who never asked for one, and an empty column reads as
	// "not rated" either way.
	ensureColumn("user_settings", "track_effort", `ALTER TABLE user_settings ADD COLUMN track_effort TEXT NOT NULL DEFAULT ''`)

	// Device sessions close the gap between the two revocation levers above:
	// revoked_tokens kills one token (which rotation replaces a moment later)
	// and token_version kills every device at once. A row here tracks one chain
	// of refresh rotations, so "sign out my old phone" is possible without
	// signing out the phone in your hand.
	//
	// The id is the `sid` JWT claim, not an autoincrement — it has to be
	// derivable from a presented token without a lookup.
	deviceSessions := `
CREATE TABLE IF NOT EXISTS device_sessions (
  id           TEXT     PRIMARY KEY,
  user_id      INTEGER  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label        TEXT     NOT NULL DEFAULT '',
  user_agent   TEXT     NOT NULL DEFAULT '',
  remembered   INTEGER  NOT NULL DEFAULT 0,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at   DATETIME NOT NULL,
  revoked_at   DATETIME
);
CREATE INDEX IF NOT EXISTS idx_device_sessions_user ON device_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_device_sessions_expires ON device_sessions(expires_at);`
	if _, err := DB.Exec(deviceSessions); err != nil {
		log.Fatalf("create device_sessions: %v", err)
	}

	// Passkeys (WebAuthn). The credential itself is stored as the library's own
	// JSON rather than exploded into columns: it is an opaque record we only
	// ever hand back to that library, the shape gains fields between releases,
	// and nothing in Lyftr has any business querying its internals.
	//
	// credential_id is lifted out because it's the lookup key, and user_handle
	// because a usernameless ("discoverable") login arrives with nothing else
	// to identify the account by.
	passkeys := `
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT     NOT NULL UNIQUE,
  user_handle   TEXT     NOT NULL,
  name          TEXT     NOT NULL DEFAULT '',
  credential    TEXT     NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at  DATETIME
);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user ON webauthn_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_handle ON webauthn_credentials(user_handle);`
	if _, err := DB.Exec(passkeys); err != nil {
		log.Fatalf("create webauthn_credentials: %v", err)
	}

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

	// Fields the exercise seed was fetching from free-exercise-db and throwing
	// away.
	//
	// image_url_end is the second frame of the movement (the upstream dataset
	// ships a start and an end image per exercise); the pair animates the lift,
	// where one frame is just a photo. force/level/mechanic are what the
	// library's filter chips are made of.
	//
	// source_id is the upstream slug ("Barbell_Bench_Press"). The image cache
	// keys on it, and re-deriving it from image_url is brittle.
	//
	// All five are empty until the next admin exercise sync backfills them
	// (the seed upserts on name, so existing rows refresh in place). The facets
	// endpoint filters empty values, so a chip simply doesn't appear until then.
	ensureColumn("exercises", "image_url_end", `ALTER TABLE exercises ADD COLUMN image_url_end TEXT NOT NULL DEFAULT ''`)
	ensureColumn("exercises", "force", `ALTER TABLE exercises ADD COLUMN "force" TEXT NOT NULL DEFAULT ''`)
	ensureColumn("exercises", "level", `ALTER TABLE exercises ADD COLUMN level TEXT NOT NULL DEFAULT ''`)
	ensureColumn("exercises", "mechanic", `ALTER TABLE exercises ADD COLUMN mechanic TEXT NOT NULL DEFAULT ''`)
	ensureColumn("exercises", "source_id", `ALTER TABLE exercises ADD COLUMN source_id TEXT NOT NULL DEFAULT ''`)

	// gif_url holds a real animated GIF of the movement, only populated when
	// the optional Gymvisual-sourced dataset is enabled (EXERCISE_GIF_SOURCE) —
	// see config.ExerciseGifSource and seed/exercises.go.
	ensureColumn("exercises", "gif_url", `ALTER TABLE exercises ADD COLUMN gif_url TEXT NOT NULL DEFAULT ''`)

	// Faceted filtering on the library. Honest note: at ~870 rows these fix no
	// measured problem — the `name LIKE '%q%'` scan dominates and cannot use
	// them anyway. They're here because they're free and correct by default,
	// and because source_id is looked up per image request.
	exerciseIndexes := `
CREATE INDEX IF NOT EXISTS idx_exercises_muscle    ON exercises(muscle_group);
CREATE INDEX IF NOT EXISTS idx_exercises_equipment ON exercises(equipment);
CREATE INDEX IF NOT EXISTS idx_exercises_category  ON exercises(category);
CREATE INDEX IF NOT EXISTS idx_exercises_level     ON exercises(level);
CREATE INDEX IF NOT EXISTS idx_exercises_source_id ON exercises(source_id);`
	if _, err := DB.Exec(exerciseIndexes); err != nil {
		log.Fatalf("create exercise facet indexes: %v", err)
	}

	// Weekly training schedule: which programs belong on which weekday, so the
	// app can answer "what am I doing today".
	//
	// A join table rather than a weekday column on programs, because the same
	// program belongs on several days (Push on Mon and Thu) and one day can
	// carry more than one (mobility plus legs). Neither fits in a column.
	//
	// The overrides table holds one-off deviations. A row there REPLACES the
	// recurring pattern for that single date and leaves the pattern untouched,
	// so "move leg day to Tuesday this week" is a rest row on Monday plus a set
	// row on Tuesday, and next Monday is still leg day. program_id NULL means an
	// explicit rest day, which is distinct from having no override at all (that
	// falls through to the pattern).
	//
	// on_date rather than `date`: legal, but it shadows the SQL function and
	// reads badly in every query. IFNULL(program_id, 0) in the unique index is
	// what makes "one rest row per date" enforceable — NULL != NULL would
	// otherwise allow duplicates.
	//
	// ON DELETE CASCADE on program_id means deleting a program unschedules it,
	// which is the right behaviour and needs no application code.
	schedule := `
CREATE TABLE IF NOT EXISTS program_schedules (
  id          INTEGER  PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id  INTEGER  NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  weekday     INTEGER  NOT NULL,           -- 0=Sunday .. 6=Saturday (Go's time.Weekday)
  order_index INTEGER  NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_program_schedules_uniq ON program_schedules(user_id, weekday, program_id);
CREATE INDEX IF NOT EXISTS idx_program_schedules_user_day ON program_schedules(user_id, weekday);

CREATE TABLE IF NOT EXISTS program_schedule_overrides (
  id          INTEGER  PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  on_date     TEXT     NOT NULL,           -- 'YYYY-MM-DD', the user's LOCAL day
  program_id  INTEGER  REFERENCES programs(id) ON DELETE CASCADE, -- NULL = rest
  order_index INTEGER  NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_overrides_uniq ON program_schedule_overrides(user_id, on_date, IFNULL(program_id, 0));
CREATE INDEX IF NOT EXISTS idx_schedule_overrides_user_date ON program_schedule_overrides(user_id, on_date);`
	if _, err := DB.Exec(schedule); err != nil {
		log.Fatalf("create program schedule tables: %v", err)
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
  name          TEXT    NOT NULL DEFAULT '',
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
  steps               INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS blood_pressure_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  systolic   INTEGER NOT NULL,
  diastolic  INTEGER NOT NULL,
  pulse      INTEGER NOT NULL DEFAULT 0,
  context    TEXT    NOT NULL DEFAULT '',
  arm        TEXT    NOT NULL DEFAULT '',
  position   TEXT    NOT NULL DEFAULT '',
  rested     INTEGER NOT NULL DEFAULT 0,
  notes      TEXT    NOT NULL DEFAULT '',
  tz_offset  INTEGER NOT NULL DEFAULT 0,
  logged_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bp_logs_user ON blood_pressure_logs(user_id, logged_at DESC);

CREATE TABLE IF NOT EXISTS bp_insights (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  facts      TEXT     NOT NULL,
  report     TEXT     NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bp_insights_user ON bp_insights(user_id, created_at DESC);

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

-- Resolved barcode lookups, keyed by 14-digit GTIN. Unlike saved_foods this is
-- deliberately global rather than per-user: a UPC identifies the same physical
-- product for everyone, and the row holds only public product data — nothing
-- about who scanned it or when they ate it.
CREATE TABLE IF NOT EXISTS food_products (
  gtin       TEXT     PRIMARY KEY,
  payload    TEXT     NOT NULL,
  source     TEXT     NOT NULL DEFAULT '',
  fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
