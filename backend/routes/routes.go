package routes

import (
	"slices"
	"strings"
	"time"

	"github.com/Cawlumm/lyftr-backend/config"
	"github.com/Cawlumm/lyftr-backend/controllers"
	"github.com/Cawlumm/lyftr-backend/middleware"
	"github.com/Cawlumm/lyftr-backend/stores"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func Setup(r *gin.Engine, h *controllers.Handler, s *stores.Stores) {
	r.Use(cors.New(corsConfig()))

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	api := r.Group("/api/v1")

	// Public: "test connection" probe for the in-app server selector.
	api.GET("/info", h.ServerInfo)

	// Auth (public) — rate-limited per IP since these are the only endpoints
	// where an unauthenticated caller can grind on credentials.
	auth := api.Group("/auth")
	auth.Use(middleware.RateLimit(10, time.Minute))
	{
		auth.POST("/register", h.Register)
		auth.POST("/login", h.Login)
		auth.POST("/refresh", h.RefreshToken)
		// Passkey sign-in. Public and inside the rate-limited group like the
		// other credential endpoints. Usernameless (discoverable): no account is
		// named, so neither call reveals whether one exists.
		auth.POST("/webauthn/login/begin", h.BeginPasskeyLogin)
		auth.POST("/webauthn/login/finish", h.FinishPasskeyLogin)
	}

	// Exercise demo frames. The only unauthenticated route outside /health,
	// /info and /auth, and deliberately so: an <img src> cannot send an
	// Authorization header, which is the only place middleware.Auth looks. See
	// the comment on ServeExerciseImage for why an exercise photo is safe to
	// serve anonymously where a meal photo is not.
	api.GET("/exercises/:id/image", h.ServeExerciseImage)
	api.GET("/exercises/:id/image/:frame", h.ServeExerciseImage)

	// Protected routes
	protected := api.Group("/")
	protected.Use(middleware.Auth(s))
	{
		// User
		protected.GET("me", h.GetMe)
		protected.PUT("me", h.UpdateMe)
		protected.GET("settings", h.GetSettings)
		protected.PUT("settings", h.UpdateSettings)
		protected.DELETE("me", h.DeleteAccount)
		// Password change invalidates every session, so it lives behind Auth
		// (the caller must already be logged in) rather than under /auth.
		protected.PUT("me/password", h.ChangePassword)
		// Logout is authenticated: it needs the access token it is revoking.
		protected.POST("auth/logout", h.Logout)
		// Signed-in devices. Like the token routes below, JWT-only (enforced in
		// the handlers) — a PAT must not be able to enumerate or sign out the
		// interactive sessions of the account it belongs to.
		protected.GET("sessions", h.ListSessions)
		protected.DELETE("sessions/:id", h.RevokeSession)

		// Passkey enrolment and management. JWT-only (enforced in the handlers)
		// for the same reason as the token routes: a PAT must not be able to
		// attach a new way of signing in to the account it belongs to.
		protected.GET("passkeys", h.ListPasskeys)
		protected.DELETE("passkeys/:id", h.DeletePasskey)
		protected.POST("passkeys/register/begin", h.BeginPasskeyRegistration)
		protected.POST("passkeys/register/finish", h.FinishPasskeyRegistration)
		protected.GET("profile", h.GetProfile)
		protected.PUT("profile", h.UpdateProfile)

		// Personal access tokens — long-lived bearer tokens for non-interactive
		// clients (MCP server, scripts). Management itself requires JWT auth
		// (enforced in the handlers): a PAT must never be usable to mint, list,
		// or revoke tokens, including itself.
		protected.GET("tokens", h.ListTokens)
		protected.POST("tokens", h.CreateToken)
		protected.DELETE("tokens/:id", h.RevokeToken)

		// Workouts
		protected.GET("workouts", h.ListWorkouts)
		protected.POST("workouts", h.CreateWorkout)
		// Named sub-path before the :id wildcard, or the wildcard swallows it.
		protected.GET("workouts/stats", h.GetWorkoutStats)
		protected.GET("workouts/prs", h.GetRecentPRs)
		protected.GET("workouts/:id", h.GetWorkout)
		protected.PUT("workouts/:id", h.UpdateWorkout)
		protected.DELETE("workouts/:id", h.DeleteWorkout)

		// Weight
		protected.GET("weight", h.ListWeightLogs)
		protected.POST("weight", h.LogWeight)
		protected.GET("weight/stats", h.GetWeightStats)

		// Weight-loss plan — static sub-paths must be registered before weight/:id
		protected.POST("weight/plan/generate", h.GenerateWeightPlan)
		protected.POST("weight/plan/accept", h.AcceptWeightPlan)
		protected.GET("weight/plan/current", h.GetCurrentNutritionGoal)
		protected.GET("weight/plan/goals", h.GetNutritionGoalHistory)
		protected.GET("weight/plan/adherence", h.GetWeightPlanAdherence)
		protected.GET("weight/plan/history", h.GetWeightPlanHistory)
		// Progress check-in: POST generates (a slow, user-triggered AI call),
		// GET only reads the last stored one — reading must never generate.
		protected.POST("weight/plan/checkin", h.RunWeightPlanCheckin)
		protected.GET("weight/plan/checkin", h.GetLatestWeightPlanCheckin)

		protected.GET("weight/:id", h.GetWeightLog)
		protected.PATCH("weight/:id", h.UpdateWeightLog)
		protected.DELETE("weight/:id", h.DeleteWeightLog)

		// Blood pressure — static sub-paths before blood-pressure/:id
		protected.GET("blood-pressure", h.ListBloodPressureLogs)
		protected.POST("blood-pressure", h.LogBloodPressure)
		protected.GET("blood-pressure/stats", h.GetBloodPressureStats)
		// Insight: POST generates (a slow, user-triggered AI call), GET only
		// reads the last stored one — reading must never generate.
		protected.POST("blood-pressure/insight", h.RunBPInsight)
		protected.GET("blood-pressure/insight", h.GetLatestBPInsight)
		protected.GET("blood-pressure/:id", h.GetBloodPressureLog)
		protected.PATCH("blood-pressure/:id", h.UpdateBloodPressureLog)
		protected.DELETE("blood-pressure/:id", h.DeleteBloodPressureLog)

		// Cardio sessions imported from a companion device — static sub-paths
		// before cardio/:id.
		protected.GET("cardio", h.ListCardioSessions)
		protected.GET("cardio/stats", h.GetCardioStats)
		protected.POST("cardio/import", h.ImportCardioSessions)
		protected.GET("cardio/:id", h.GetCardioSession)
		protected.DELETE("cardio/:id", h.DeleteCardioSession)

		// Heart rate / health metrics / sleep, imported from a companion
		// device's health platform (e.g. Health Connect). Named sub-paths
		// registered before sleep/:id for the same reason as cardio above.
		protected.GET("heart-rate", h.ListHeartRateSamples)
		protected.GET("heart-rate/daily", h.GetHeartRateDailyStats)
		protected.GET("heart-rate/zones", h.GetHeartRateZones)
		protected.POST("heart-rate/import", h.ImportHeartRateSamples)
		protected.GET("health-metrics", h.ListHealthMetrics)
		protected.POST("health-metrics/import", h.ImportHealthMetrics)
		protected.GET("sleep", h.ListSleepSessions)
		protected.GET("sleep/daily", h.GetSleepDailySummary)
		protected.POST("sleep/import", h.ImportSleepSessions)
		protected.GET("sleep/:id", h.GetSleepSession)

		// Cross-metric hub summary — the seam a future metric plugs into.
		protected.GET("health/summary", h.GetHealthSummary)

		// Food — named sub-paths must be registered before food/:id
		protected.GET("food", h.ListFoodLogs)
		protected.POST("food", h.LogFood)
		protected.GET("food/stats", h.GetDailyStats)
		protected.GET("food/history", h.GetFoodHistory)
		protected.GET("food/recent", h.ListRecentFoods)
		protected.GET("food/search", h.SearchFood)
		protected.GET("food/barcode/:code", h.LookupBarcode)
		protected.GET("food/saved", h.ListSavedFoods)
		protected.POST("food/saved", h.CreateSavedFood)
		protected.GET("food/saved/:id", h.GetSavedFood)
		protected.PUT("food/saved/:id", h.UpdateSavedFood)
		protected.DELETE("food/saved/:id", h.DeleteSavedFood)
		protected.POST("food/analyze-label", h.AnalyzeFoodLabel)
		protected.POST("food/parse-meal", h.ParseMeal)
		protected.POST("food/analyze-meal-photo", h.AnalyzeMealPhoto)
		protected.GET("food/photos/:userID/:filename", h.ServeMealPhoto)
		protected.POST("food/recommend", h.RecommendMeals)
		protected.POST("food/copy", h.CopyFoodLogs)
		protected.POST("food/:id/save", h.SaveFoodLogToMyFoods)
		protected.GET("food/:id", h.GetFoodLog)
		protected.PATCH("food/:id", h.UpdateFoodLog)
		protected.DELETE("food/:id", h.DeleteFoodLog)

		// Weekly training schedule. A flat namespace on purpose: the only
		// wildcard is overrides/:date, so no static sub-path can collide with
		// it. Don't add schedule/:id.
		protected.GET("schedule", h.GetSchedule)
		protected.PUT("schedule", h.ReplaceSchedule)
		protected.GET("schedule/today", h.GetTodaysWorkout)
		protected.POST("schedule/overrides", h.SetScheduleOverride)
		protected.DELETE("schedule/overrides/:date", h.ClearScheduleOverride)

		// Exercises (mostly read-only for users; POST adds a custom entry)
		protected.GET("exercises", h.ListExercises)
		protected.POST("exercises", h.CreateExercise)
		protected.PUT("exercises/:id", h.UpdateExercise)
		protected.PATCH("exercises/:id/timed", h.SetExerciseTimed)
		protected.DELETE("exercises/:id", h.DeleteExercise)
		// Named sub-path before the :id wildcard, or the wildcard swallows it.
		protected.GET("exercises/facets", h.GetExerciseFacets)
		protected.GET("exercises/:id", h.GetExercise)
		protected.GET("exercises/:id/prs", h.GetExercisePRs)
		protected.GET("exercises/:id/history", h.GetExerciseHistory)

		// Active session
		protected.GET("active-session", h.GetActiveSession)
		protected.PUT("active-session", h.UpsertActiveSession)
		protected.DELETE("active-session", h.DeleteActiveSession)

		// Programs
		protected.GET("programs", h.ListPrograms)
		protected.POST("programs", h.CreateProgram)
		protected.POST("programs/generate", h.GenerateProgram) // static path before :id wildcard
		protected.GET("programs/shared", h.ListSharedPrograms) // static path before :id wildcard
		protected.GET("programs/:id", h.GetProgram)
		protected.PUT("programs/:id", h.UpdateProgram)
		protected.DELETE("programs/:id", h.DeleteProgram)
		protected.POST("programs/:id/share", h.ShareProgram)
		protected.POST("programs/:id/unshare", h.UnshareProgram)
		protected.POST("programs/:id/copy", h.CopyProgram)

		// Admin — additionally gated by the ADMIN_EMAILS allow-list; closed
		// to everyone when unset (reset-exercises wipes the whole library).
		admin := protected.Group("admin")
		admin.Use(middleware.AdminOnly())
		{
			admin.POST("/sync-exercises", h.SyncExercises)
			admin.GET("/seed-status", h.ExerciseSeedStatus)
			admin.POST("/reset-exercises", h.ResetExercises)

			admin.GET("/exercise-migration/status", h.GetExerciseMigrationStatus)
			admin.POST("/exercise-migration/preview", h.PreviewExerciseMigration)
			admin.POST("/exercise-migration/:id/confirm", h.ConfirmExerciseMigration)
		}
	}
}

// corsConfig builds the CORS policy. Auth is Bearer-token based (no cookies), so
// credentials mode is off — which also lets the wildcard origin be valid. In
// development, or when CORS_ORIGIN is unset or "*", any origin is allowed; in
// production CORS_ORIGIN is a comma-separated allow-list of client origins.
func corsConfig() cors.Config {
	cfg := cors.Config{
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		AllowCredentials: false,
	}

	origins := parseOrigins(config.C.CORSOrigin)
	if config.C.Env == "development" || len(origins) == 0 || slices.Contains(origins, "*") {
		cfg.AllowAllOrigins = true
	} else {
		cfg.AllowOrigins = origins
	}
	return cfg
}

func parseOrigins(raw string) []string {
	out := make([]string, 0)
	for _, p := range strings.Split(raw, ",") {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}
