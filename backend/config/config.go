package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"slices"
	"strconv"
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
	// RefreshExpiryHours is the refresh-token lifetime for a session the user
	// did not ask to be remembered (REFRESH_EXPIRY, hours) — see
	// utils.RefreshTTL. Short by design; long sessions are opt-in per device.
	RefreshExpiryHours string
	// MaxSessionDaysRaw caps the per-user session-length preference
	// (MAX_SESSION_DAYS). The preference is user-editable, so the operator
	// needs a bound the user cannot raise. Read via MaxSessionDays().
	MaxSessionDaysRaw string
	// AbsoluteSessionDaysRaw caps how long one chain of refresh rotations may
	// live regardless of activity (SESSION_ABSOLUTE_DAYS). Read via
	// AbsoluteSessionDays().
	AbsoluteSessionDaysRaw string
	CORSOrigin             string
	Env                    string
	Version                string

	// SeedDemo controls the demo user + demo workout/food data. Opt-in
	// everywhere: only SEED_DEMO=true enables it. The demo account has a
	// publicly documented password, so it must never appear by default. The
	// exercise library seed is unaffected (reference data, not credentials).
	SeedDemo bool

	// AdminEmails is the comma-separated allow-list (ADMIN_EMAILS) of user
	// emails permitted to call the /admin/* endpoints. Empty means no one:
	// the admin surface is closed unless explicitly opened.
	//
	// Emails are self-asserted at registration and never verified, so an
	// address listed here that has not been registered yet is claimable by
	// whoever registers it first. Keep registration closed (see
	// AllowRegistration) or register the admin account before setting this.
	AdminEmails []string

	// AllowRegistration opens POST /auth/register. Off by default: a
	// self-hosted instance normally has a fixed set of accounts, so an open
	// signup endpoint is attack surface with no upside. Existing users are
	// unaffected when it is off.
	AllowRegistration bool

	// RegistrationInviteCode, when non-empty, additionally requires callers of
	// /auth/register to present a matching invite_code. Lets registration stay
	// open for onboarding household members without being open to the network.
	RegistrationInviteCode []byte

	// TrustedProxies lists the CIDRs/IPs (TRUSTED_PROXIES) permitted to set
	// X-Forwarded-For. Gin's default is to trust every proxy, which lets any
	// client forge its own source IP and so mint unlimited rate-limit buckets.
	// Empty means trust nothing and use the direct peer address.
	TrustedProxies []string

	// Passkey (WebAuthn) sign-in. Optional and off unless WEBAUTHN_RP_ID is set,
	// because it cannot be guessed safely: WebAuthn binds every credential to a
	// fixed Relying Party ID, and getting it wrong doesn't degrade — it makes
	// enrolled passkeys permanently unusable.
	//
	// WebAuthnRPID must be the registrable domain the app is served from
	// ("lyftr.example.com"). An IP address is not a valid RP ID, so an instance
	// reached by bare LAN IP cannot use passkeys at all.
	WebAuthnRPID string
	// WebAuthnRPOrigins are the full origins allowed to complete a ceremony
	// ("https://lyftr.example.com"). Defaults to https:// + the RP ID.
	// Browsers require a secure context, so plain HTTP will not work off
	// localhost however this is set.
	WebAuthnRPOrigins []string
	// WebAuthnRPName is what the passkey is labelled as in the user's password
	// manager or keychain.
	WebAuthnRPName string

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

	// AIHealthInsightsEnabled governs the features that send health data — blood
	// pressure history, body metrics — to a third-party LLM. Deliberately
	// separate from VisionProvider: enabling meal-photo scanning must not
	// silently also start exporting the household's health records. Off by
	// default, and a per-user opt-in is required on top of it.
	AIHealthInsightsEnabled bool

	// FDCAPIKey enables USDA FoodData Central as a second food-search source
	// alongside Open Food Facts (optional). OFF is packaged-goods heavy; FDC
	// covers generic whole foods and — the reason it's worth a second call —
	// publishes real household-measure gram weights (1 tbsp = 13.8 g) that the
	// portion picker needs. Empty means FDC is skipped entirely.
	FDCAPIKey string

	// MealPhotoDir is where persisted meal photos (from AnalyzeMealPhoto) are
	// stored on disk, one subdirectory per user. Defaults to a subdirectory
	// of the sqlite data dir so it rides the same docker-compose volume with
	// no extra mount required.
	MealPhotoDir string

	// ExerciseImageDir caches the exercise library's movement frames on local
	// disk, fetched lazily on first request. Two reasons, neither cosmetic:
	// the PWA is expected to work in a gym with no signal, and hot-linking
	// ~870 exercises x 2 frames off raw.githubusercontent.com on every page
	// view is leaning on someone else's bandwidth. Fully warmed it is ~70 MB.
	// Defaults beside the sqlite file so it rides the same volume, exactly
	// like MealPhotoDir.
	ExerciseImageDir string

	// ExerciseGifSource switches the library seed from free-exercise-db
	// (default) to hasaneyldrm/exercises-dataset, which ships a real animated
	// GIF per exercise instead of a two-frame photo crossfade. Opt-in and off
	// by default: that dataset's media is copyrighted by Gymvisual and
	// redistributing it requires a license from them (see its NOTICE/README) —
	// self-hosters who want it are expected to review those terms themselves
	// before setting EXERCISE_GIF_SOURCE=true. Flipping this after the library
	// is already seeded from the other source doesn't replace existing rows;
	// pair it with an admin "reset exercises" to get a clean swap.
	ExerciseGifSource bool
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
		JWTSecret:  getEnv("JWT_SECRET", ""),
		JWTExpiry:  getEnv("JWT_EXPIRY", "3600"),

		RefreshExpiryHours:     getEnv("REFRESH_EXPIRY", "12"),
		MaxSessionDaysRaw:      getEnv("MAX_SESSION_DAYS", ""),
		AbsoluteSessionDaysRaw: getEnv("SESSION_ABSOLUTE_DAYS", ""),
		CORSOrigin:             getEnv("CORS_ORIGIN", "http://localhost:5173"),
		Env:                    getEnv("ENV", "development"),
		Version:                buildVersion,

		VisionProvider:  strings.TrimSpace(getEnv("VISION_PROVIDER", "")),
		AnthropicAPIKey: getSecret("ANTHROPIC_API_KEY", ""),
		OpenAIAPIKey:    getSecret("OPENAI_API_KEY", ""),
		GeminiAPIKey:    getSecret("GEMINI_API_KEY", ""),
		AnthropicModel:  strings.TrimSpace(getEnv("ANTHROPIC_MODEL", "")),
		OpenAIModel:     strings.TrimSpace(getEnv("OPENAI_MODEL", "")),
		GeminiModel:     strings.TrimSpace(getEnv("GEMINI_MODEL", "")),

		FDCAPIKey: getSecret("FDC_API_KEY", ""),

		MealPhotoDir:     getEnv("MEAL_PHOTO_DIR", "data/meal-photos"),
		ExerciseImageDir: getEnv("EXERCISE_IMAGE_DIR", "data/exercise-images"),
	}

	// Demo seeding is opt-in everywhere. It previously defaulted to on outside
	// production, which meant any deployment that forgot to set ENV grew a live
	// account with a publicly documented password.
	C.SeedDemo = getEnv("SEED_DEMO", "") == "true"
	C.AdminEmails = splitList(getEnv("ADMIN_EMAILS", ""))
	C.AllowRegistration = getEnv("ALLOW_REGISTRATION", "") == "true"
	C.RegistrationInviteCode = []byte(getEnv("REGISTRATION_INVITE_CODE", ""))
	C.ExerciseGifSource = getEnv("EXERCISE_GIF_SOURCE", "") == "true"
	C.TrustedProxies = splitList(getEnv("TRUSTED_PROXIES", ""))
	C.AIHealthInsightsEnabled = getEnv("AI_HEALTH_INSIGHTS_ENABLED", "") == "true"

	C.WebAuthnRPID = strings.TrimSpace(getEnv("WEBAUTHN_RP_ID", ""))
	C.WebAuthnRPName = getEnv("WEBAUTHN_RP_NAME", "Lyftr")
	C.WebAuthnRPOrigins = splitList(getEnv("WEBAUTHN_RP_ORIGINS", ""))
	if len(C.WebAuthnRPOrigins) == 0 && C.WebAuthnRPID != "" {
		// The overwhelmingly common case is one origin that is simply the RP ID
		// over TLS. Deriving it means the feature needs one env var, not two,
		// and the two can't drift apart.
		C.WebAuthnRPOrigins = []string{"https://" + C.WebAuthnRPID}
	}

	if err := C.resolveJWTSecret(); err != nil {
		log.Fatalf("config: %v", err)
	}
}

// placeholderSecrets are the values shipped in the repo's docs and examples.
// They are public, so a deployment running one has no signing key at all.
var placeholderSecrets = []string{
	"change-me-in-production-min-32-chars!!",
	"change-me-to-a-random-32-plus-character-string",
}

// minJWTSecretLen is the shortest secret we accept. HS256 keys shorter than the
// 256-bit hash output weaken the MAC and are brute-forcible offline from a
// single captured token.
const minJWTSecretLen = 32

// WeakJWTSecret reports whether s is unusable as a signing key — empty, too
// short, or one of the published placeholders.
func WeakJWTSecret(s string) bool {
	if len(s) < minJWTSecretLen {
		return true
	}
	return slices.Contains(placeholderSecrets, s)
}

// resolveJWTSecret enforces a usable signing key. Production refuses to boot
// without one. Outside production we generate a random ephemeral secret rather
// than falling back to a hardcoded default: `go run .` keeps working with no
// setup, but the key is never a value an attacker could know. The cost is that
// sessions don't survive a restart, which is why the warning says so.
func (c *Config) resolveJWTSecret() error {
	if !WeakJWTSecret(c.JWTSecret) {
		return nil
	}

	if c.Env == "production" {
		return fmt.Errorf("JWT_SECRET must be set to a random string of at least %d characters in production", minJWTSecretLen)
	}

	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Errorf("generate ephemeral JWT secret: %w", err)
	}
	c.JWTSecret = hex.EncodeToString(buf)
	log.Printf("config: JWT_SECRET is unset or too weak — generated an ephemeral one for this process. "+
		"Sessions will not survive a restart. Set JWT_SECRET to a random %d+ character string to fix.", minJWTSecretLen)
	return nil
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

// Session-length defaults. Lyftr's self-host path is a LAN/VPN instance used
// several times a day, so a remembered device defaults to a month: the threat
// a short refresh TTL defends against (a stolen localStorage token) is not
// meaningfully mitigated by re-prompting a user who will just re-enter the same
// password on the same device. The ceilings exist so an operator can tighten
// this for an exposed instance without touching code.
const (
	DefaultSessionDays         = 30
	defaultMaxSessionDays      = 90
	defaultAbsoluteSessionDays = 180
)

// MaxSessionDays is the operator's ceiling on the per-user session-length
// preference. Falls back to the default on a missing or nonsensical value
// rather than to "unlimited" — a typo in the env must not remove the bound.
func MaxSessionDays() int {
	return positiveDays(C.MaxSessionDaysRaw, defaultMaxSessionDays)
}

// AbsoluteSessionDays is the ceiling on a session chain's total age. Clamped to
// at least MaxSessionDays: an absolute cap below the sliding window would expire
// sessions before their stated lifetime, which reads as a bug rather than a
// policy.
func AbsoluteSessionDays() int {
	d := positiveDays(C.AbsoluteSessionDaysRaw, defaultAbsoluteSessionDays)
	if m := MaxSessionDays(); d < m {
		return m
	}
	return d
}

func positiveDays(raw string, fallback int) int {
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || n <= 0 {
		return fallback
	}
	return n
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// getSecret is getEnv for third-party API keys, with the two transcription
// mistakes that silently break them stripped out.
//
// Neither is exotic. docker-compose keeps quotes literally when reading a .env
// file — unlike a shell — so `FDC_API_KEY="abc"` delivers the quotes as part of
// the key, and a trailing newline survives a copy-paste out of a browser. Both
// reach the provider as a corrupted key and come back as a flat 403, which
// looks identical to "your key is wrong" and sends you off revoking a key that
// was fine all along.
//
// Deliberately NOT used for JWT_SECRET or REGISTRATION_INVITE_CODE: those are
// opaque local values, and someone may have intentionally included a quote.
// Rewriting a signing secret would silently invalidate every live session.
func getSecret(key, fallback string) string {
	v := strings.TrimSpace(getEnv(key, fallback))
	if len(v) >= 2 {
		if (v[0] == '"' && v[len(v)-1] == '"') || (v[0] == '\'' && v[len(v)-1] == '\'') {
			v = strings.TrimSpace(v[1 : len(v)-1])
		}
	}
	return v
}
