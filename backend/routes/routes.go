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
	}

	// Protected routes
	protected := api.Group("/")
	protected.Use(middleware.Auth(s))
	{
		// User
		protected.GET("me", h.GetMe)
		protected.GET("settings", h.GetSettings)
		protected.PUT("settings", h.UpdateSettings)
		protected.DELETE("me", h.DeleteAccount)
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

		protected.GET("weight/:id", h.GetWeightLog)
		protected.PATCH("weight/:id", h.UpdateWeightLog)
		protected.DELETE("weight/:id", h.DeleteWeightLog)

		// Food — named sub-paths must be registered before food/:id
		protected.GET("food", h.ListFoodLogs)
		protected.POST("food", h.LogFood)
		protected.GET("food/stats", h.GetDailyStats)
		protected.GET("food/history", h.GetFoodHistory)
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
		protected.GET("food/:id", h.GetFoodLog)
		protected.PATCH("food/:id", h.UpdateFoodLog)
		protected.DELETE("food/:id", h.DeleteFoodLog)

		// Exercises (read-only for users)
		protected.GET("exercises", h.ListExercises)
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
