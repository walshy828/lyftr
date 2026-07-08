// Package vision provides a provider-agnostic abstraction for extracting
// structured nutrition data from a photo of a nutrition facts label. Exactly
// one provider is active per deployment, selected via the VISION_PROVIDER
// env var — there is no per-request provider switching.
package vision

import (
	"context"
	"fmt"
)

// NutritionExtraction is the normalized shape every provider returns. The
// controller, frontend, and rest of the backend are unaware of which
// provider produced it — it is always a best-effort suggestion, never
// persisted directly.
type NutritionExtraction struct {
	Name        string  `json:"name,omitempty"`
	Brand       string  `json:"brand,omitempty"`
	Calories    float64 `json:"calories"`
	Protein     float64 `json:"protein"`
	Carbs       float64 `json:"carbs"`
	Fat         float64 `json:"fat"`
	Fiber       float64 `json:"fiber"`
	Sugar       float64 `json:"sugar"`
	Sodium      float64 `json:"sodium"`
	ServingSize string  `json:"serving_size,omitempty"`
}

// Provider is implemented once per vision backend (Anthropic/OpenAI/Gemini).
type Provider interface {
	// AnalyzeLabel takes a base64-encoded photo of a nutrition facts label
	// (imageBase64, no data: URI prefix) and its MIME type, and returns a
	// best-effort structured extraction. Implementations should tolerate an
	// unreadable or label-less photo by returning a mostly-zeroed
	// NutritionExtraction rather than an error — an error is reserved for
	// genuine provider/network/auth failures.
	AnalyzeLabel(ctx context.Context, imageBase64, mediaType string) (NutritionExtraction, error)
}

// Config carries the selected provider and all three providers' API keys —
// only the one named by VisionProvider needs to be set.
type Config struct {
	VisionProvider  string // "", "anthropic", "openai", or "gemini"
	AnthropicAPIKey string
	OpenAIAPIKey    string
	GeminiAPIKey    string
}

// extractionPrompt is shared across all three providers so their prompts
// and schemas can't drift apart — every implementation must request exactly
// this field set.
const extractionPrompt = `Look at this photo of a nutrition facts label and extract the following fields as JSON: name (the product name, if visible), brand (if visible), calories, protein (grams), carbs (grams), fat (grams), fiber (grams), sugar (grams), sodium (milligrams), serving_size (as printed on the label, e.g. "1 cup (240ml)").

Use the per-serving values as printed on the label. If a field isn't visible or the label can't be read, use 0 for numeric fields and omit name/brand/serving_size rather than guessing.`

// New selects and constructs the configured provider. It returns (nil, nil)
// — not an error — when VisionProvider is unset, since photo import is an
// optional feature and the rest of the app must keep working without it.
// It returns an error only when VisionProvider names a provider whose
// corresponding API key is missing, or names an unknown provider — callers
// should log this and continue running with a nil Provider (see main.go),
// not treat it as fatal.
func New(cfg Config) (Provider, error) {
	switch cfg.VisionProvider {
	case "":
		return nil, nil
	case "anthropic":
		if cfg.AnthropicAPIKey == "" {
			return nil, fmt.Errorf("VISION_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set")
		}
		return newAnthropicProvider(cfg.AnthropicAPIKey), nil
	case "openai":
		if cfg.OpenAIAPIKey == "" {
			return nil, fmt.Errorf("VISION_PROVIDER=openai but OPENAI_API_KEY is not set")
		}
		return newOpenAIProvider(cfg.OpenAIAPIKey), nil
	case "gemini":
		if cfg.GeminiAPIKey == "" {
			return nil, fmt.Errorf("VISION_PROVIDER=gemini but GEMINI_API_KEY is not set")
		}
		return newGeminiProvider(cfg.GeminiAPIKey), nil
	default:
		return nil, fmt.Errorf("unknown VISION_PROVIDER %q (expected anthropic, openai, or gemini)", cfg.VisionProvider)
	}
}

// nutritionJSONSchema is the JSON schema all three providers' structured
// output requests should target — kept as a plain map so each provider's
// SDK can embed it in whatever shape its structured-output feature expects.
func nutritionJSONSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"name":         map[string]any{"type": "string"},
			"brand":        map[string]any{"type": "string"},
			"calories":     map[string]any{"type": "number"},
			"protein":      map[string]any{"type": "number"},
			"carbs":        map[string]any{"type": "number"},
			"fat":          map[string]any{"type": "number"},
			"fiber":        map[string]any{"type": "number"},
			"sugar":        map[string]any{"type": "number"},
			"sodium":       map[string]any{"type": "number"},
			"serving_size": map[string]any{"type": "string"},
		},
		"required":             []string{"calories", "protein", "carbs", "fat"},
		"additionalProperties": false,
	}
}
