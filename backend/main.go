package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/Cawlumm/lyftr-backend/config"
	"github.com/Cawlumm/lyftr-backend/controllers"
	"github.com/Cawlumm/lyftr-backend/db"
	"github.com/Cawlumm/lyftr-backend/routes"
	"github.com/Cawlumm/lyftr-backend/seed"
	"github.com/Cawlumm/lyftr-backend/stores"
	"github.com/Cawlumm/lyftr-backend/vision"
	"github.com/gin-gonic/gin"
)

func main() {
	showVersion := flag.Bool("version", false, "print the build version and exit")
	flag.Parse()
	if *showVersion {
		fmt.Printf("lyftr %s\n", config.Version())
		os.Exit(0)
	}

	config.Load()
	db.Connect()
	// Demo user/data carry a well-known password (demo@lyftr.local /
	// password123) and must never end up on a production deployment.
	if config.C.SeedDemo {
		seed.DemoUser(db.DB)
	}
	seed.Exercises(db.DB)
	if config.C.SeedDemo {
		go seed.DemoData(db.DB)
	}

	if config.C.Env == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.Default()
	// Gin trusts every proxy by default, so c.ClientIP() would come from a
	// client-supplied X-Forwarded-For — and the auth rate limiter keys its
	// buckets on exactly that. Nil (the empty case) means "trust no proxy,
	// use the direct peer address", which is correct for a directly exposed
	// backend; set TRUSTED_PROXIES when running behind nginx/Caddy/Cloudflare.
	if err := r.SetTrustedProxies(config.C.TrustedProxies); err != nil {
		log.Fatalf("invalid TRUSTED_PROXIES: %v", err)
	}

	s := stores.New(db.DB)

	visionProvider, err := vision.New(vision.Config{
		VisionProvider:  config.C.VisionProvider,
		AnthropicAPIKey: config.C.AnthropicAPIKey,
		OpenAIAPIKey:    config.C.OpenAIAPIKey,
		GeminiAPIKey:    config.C.GeminiAPIKey,
		AnthropicModel:  config.C.AnthropicModel,
		OpenAIModel:     config.C.OpenAIModel,
		GeminiModel:     config.C.GeminiModel,
	})
	if err != nil {
		log.Printf("vision: %v (photo import disabled)", err)
	}

	h := controllers.NewHandler(s, visionProvider)
	routes.Setup(r, h, s)

	// Revocation rows are only needed until the token would have expired on its
	// own; after that the signature check rejects it anyway. Prune hourly so the
	// table tracks active sessions rather than growing forever.
	go func() {
		for {
			if n, err := s.Token.PurgeExpiredRevocations(); err != nil {
				log.Printf("revocation purge: %v", err)
			} else if n > 0 {
				log.Printf("revocation purge: removed %d expired entries", n)
			}
			time.Sleep(time.Hour)
		}
	}()

	addr := ":" + config.C.Port
	log.Printf("lyftr API listening on %s (env=%s)", addr, config.C.Env)
	if err := r.Run(addr); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
