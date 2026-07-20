package config

import (
	"log"
	"os"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	Port       string
	DBType     string // "sqlite" or "postgres"
	DBPath     string // sqlite only
	DBHost     string // postgres only
	DBPort     string
	DBName     string
	DBUser     string
	DBPassword string
	JWTSecret  string
	JWTExpiry  string
	CORSOrigin string
	Env        string
	Version    string

	// SeedDemo controls the demo user + demo workout/food data. Defaults to
	// on in development and off in production; ENV var SEED_DEMO=true/false
	// overrides either way. The exercise library seed is unaffected (it's
	// reference data, not credentials).
	SeedDemo bool

	// AdminEmails is the comma-separated allow-list (ADMIN_EMAILS) of user
	// emails permitted to call the /admin/* endpoints. Empty means no one:
	// the admin surface is closed unless explicitly opened.
	AdminEmails []string

	// Nutrition label photo import (optional). VisionProvider selects which
	// of the three keys below is used; leave it unset to disable the feature.
	// The *Model fields are optional overrides — each provider falls back to
	// its own built-in default model when left empty.
	VisionProvider  string
	AnthropicAPIKey string
	OpenAIAPIKey    string
	GeminiAPIKey    string
	AnthropicModel  string
	OpenAIModel     string
	GeminiModel     string

	// MealPhotoDir is where persisted meal photos (from AnalyzeMealPhoto) are
	// stored on disk, one subdirectory per user. Defaults to a subdirectory
	// of the sqlite data dir so it rides the same docker-compose volume with
	// no extra mount required.
	MealPhotoDir string
}

var C *Config

// buildVersion is set at build time via:
//
//	-ldflags "-X github.com/Cawlumm/lyftr-backend/config.buildVersion=$VERSION"
//
// where the Dockerfiles pass the git tag as the VERSION build-arg. It falls back
// to "dev" for local/untagged builds. If you rename this var or the package, also
// update backend/build.sh (the shared ldflags) and the version-smoke CI job, or the
// injection will silently no-op and ship "dev".
var buildVersion = "dev"

// Version returns the build-time version. Unlike C.Version it needs no Load(),
// so the --version flag can report it without touching env or the database.
func Version() string { return buildVersion }

func Load() {
	_ = godotenv.Load()

	C = &Config{
		Port:       getEnv("PORT", "3000"),
		DBType:     getEnv("DB_TYPE", "sqlite"),
		DBPath:     getEnv("DB_PATH", "./data/lyftr.db"),
		DBHost:     getEnv("DB_HOST", "localhost"),
		DBPort:     getEnv("DB_PORT", "5432"),
		DBName:     getEnv("DB_NAME", "lyftr"),
		DBUser:     getEnv("DB_USER", "postgres"),
		DBPassword: getEnv("DB_PASSWORD", ""),
		JWTSecret:  getEnv("JWT_SECRET", "change-me-in-production-min-32-chars!!"),
		JWTExpiry:  getEnv("JWT_EXPIRY", "3600"),
		CORSOrigin: getEnv("CORS_ORIGIN", "http://localhost:5173"),
		Env:        getEnv("ENV", "development"),
		Version:    buildVersion,

		VisionProvider:  getEnv("VISION_PROVIDER", ""),
		AnthropicAPIKey: getEnv("ANTHROPIC_API_KEY", ""),
		OpenAIAPIKey:    getEnv("OPENAI_API_KEY", ""),
		GeminiAPIKey:    getEnv("GEMINI_API_KEY", ""),
		AnthropicModel:  getEnv("ANTHROPIC_MODEL", ""),
		OpenAIModel:     getEnv("OPENAI_MODEL", ""),
		GeminiModel:     getEnv("GEMINI_MODEL", ""),

		MealPhotoDir: getEnv("MEAL_PHOTO_DIR", "data/meal-photos"),
	}

	C.SeedDemo = getEnv("SEED_DEMO", "") == "true" ||
		(C.Env != "production" && getEnv("SEED_DEMO", "") != "false")
	C.AdminEmails = splitList(getEnv("ADMIN_EMAILS", ""))

	if C.Env == "production" && C.JWTSecret == "change-me-in-production-min-32-chars!!" {
		log.Fatal("JWT_SECRET must be set in production")
	}
}

func splitList(raw string) []string {
	out := make([]string, 0)
	for _, p := range strings.Split(raw, ",") {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
