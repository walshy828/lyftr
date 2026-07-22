package vision

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"

	"google.golang.org/genai"
)

// TODO(verify): confirm google.golang.org/genai (the newer unified Gemini Go
// SDK) is current/recommended at implementation time, vs. the older
// github.com/google/generative-ai-go/genai. Google has been migrating
// developers toward the unified SDK, but this must be checked before relying
// on the call shape below.
//
// TODO(verify): confirm the current gemini-2.x-flash-class vision+JSON-mode
// model string. Overridable per-deployment via the GEMINI_MODEL env var.
const geminiModel = "gemini-2.0-flash"

type geminiProvider struct {
	apiKey string
	model  string
}

func newGeminiProvider(apiKey, model string) *geminiProvider {
	if model == "" {
		model = geminiModel
	}
	return &geminiProvider{apiKey: apiKey, model: model}
}

func (p *geminiProvider) AnalyzeLabel(ctx context.Context, imageBase64Data, mediaType string) (NutritionExtraction, error) {
	// TODO(verify): exact Go binding for client construction, inline image
	// bytes + text prompt content, and structured JSON output
	// (ResponseMIMEType/ResponseSchema or equivalent field names) — the shape
	// below follows the documented Gemini API concepts but the Go SDK's typed
	// constructors/param names must be confirmed via `go doc
	// google.golang.org/genai` or a compile-fix loop.
	client, err := genai.NewClient(ctx, &genai.ClientConfig{
		APIKey:  p.apiKey,
		Backend: genai.BackendGeminiAPI,
	})
	if err != nil {
		return NutritionExtraction{}, fmt.Errorf("gemini client: %w", err)
	}

	imgBytes, err := base64.StdEncoding.DecodeString(imageBase64Data)
	if err != nil {
		return NutritionExtraction{}, fmt.Errorf("gemini vision call: decode image: %w", err)
	}

	resp, err := client.Models.GenerateContent(ctx, p.model,
		[]*genai.Content{
			genai.NewContentFromParts([]*genai.Part{
				genai.NewPartFromBytes(imgBytes, mediaType),
				genai.NewPartFromText(extractionPrompt),
			}, genai.RoleUser),
		},
		&genai.GenerateContentConfig{
			ResponseMIMEType:   "application/json",
			ResponseJsonSchema: nutritionJSONSchema(),
		},
	)
	if err != nil {
		return NutritionExtraction{}, fmt.Errorf("gemini vision call: %w", err)
	}

	text := resp.Text()
	if text == "" {
		return NutritionExtraction{}, fmt.Errorf("gemini vision call: empty response text")
	}

	var out NutritionExtraction
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		return NutritionExtraction{}, fmt.Errorf("gemini vision call: unmarshal structured output: %w", err)
	}
	return out, nil
}

func (p *geminiProvider) ParseMeal(ctx context.Context, description string) ([]MealItem, error) {
	client, err := genai.NewClient(ctx, &genai.ClientConfig{
		APIKey:  p.apiKey,
		Backend: genai.BackendGeminiAPI,
	})
	if err != nil {
		return nil, fmt.Errorf("gemini client: %w", err)
	}

	resp, err := client.Models.GenerateContent(ctx, p.model,
		[]*genai.Content{
			genai.NewContentFromParts([]*genai.Part{
				genai.NewPartFromText(mealParsePrompt + description),
			}, genai.RoleUser),
		},
		&genai.GenerateContentConfig{
			ResponseMIMEType:   "application/json",
			ResponseJsonSchema: mealParseJSONSchema(),
		},
	)
	if err != nil {
		return nil, fmt.Errorf("gemini meal parse call: %w", err)
	}

	text := resp.Text()
	if text == "" {
		return nil, fmt.Errorf("gemini meal parse call: empty response text")
	}

	var out struct {
		Items []MealItem `json:"items"`
	}
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		return nil, fmt.Errorf("gemini meal parse call: unmarshal structured output: %w", err)
	}
	return out.Items, nil
}

func (p *geminiProvider) AnalyzeMealPhoto(ctx context.Context, imageBase64Data, mediaType, description string) (MealPhotoAnalysis, error) {
	client, err := genai.NewClient(ctx, &genai.ClientConfig{
		APIKey:  p.apiKey,
		Backend: genai.BackendGeminiAPI,
	})
	if err != nil {
		return MealPhotoAnalysis{}, fmt.Errorf("gemini client: %w", err)
	}

	imgBytes, err := base64.StdEncoding.DecodeString(imageBase64Data)
	if err != nil {
		return MealPhotoAnalysis{}, fmt.Errorf("gemini meal photo call: decode image: %w", err)
	}

	resp, err := client.Models.GenerateContent(ctx, p.model,
		[]*genai.Content{
			genai.NewContentFromParts([]*genai.Part{
				genai.NewPartFromBytes(imgBytes, mediaType),
				genai.NewPartFromText(mealPhotoAnalysisPromptWithDescription(description)),
			}, genai.RoleUser),
		},
		&genai.GenerateContentConfig{
			ResponseMIMEType:   "application/json",
			ResponseJsonSchema: mealPhotoAnalysisJSONSchema(),
		},
	)
	if err != nil {
		return MealPhotoAnalysis{}, fmt.Errorf("gemini meal photo call: %w", err)
	}

	text := resp.Text()
	if text == "" {
		return MealPhotoAnalysis{}, fmt.Errorf("gemini meal photo call: empty response text")
	}

	var out MealPhotoAnalysis
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		return MealPhotoAnalysis{}, fmt.Errorf("gemini meal photo call: unmarshal structured output: %w", err)
	}
	return out, nil
}

func (p *geminiProvider) GenerateProgram(ctx context.Context, req GenerateProgramRequest) ([]DraftProgram, error) {
	client, err := genai.NewClient(ctx, &genai.ClientConfig{
		APIKey:  p.apiKey,
		Backend: genai.BackendGeminiAPI,
	})
	if err != nil {
		return nil, fmt.Errorf("gemini client: %w", err)
	}

	resp, err := client.Models.GenerateContent(ctx, p.model,
		[]*genai.Content{
			genai.NewContentFromParts([]*genai.Part{
				genai.NewPartFromText(generateProgramPrompt(req)),
			}, genai.RoleUser),
		},
		&genai.GenerateContentConfig{
			ResponseMIMEType:   "application/json",
			ResponseJsonSchema: draftProgramJSONSchema(),
		},
	)
	if err != nil {
		return nil, fmt.Errorf("gemini generate program call: %w", err)
	}

	text := resp.Text()
	if text == "" {
		return nil, fmt.Errorf("gemini generate program call: empty response text")
	}

	var out struct {
		Programs []DraftProgram `json:"programs"`
	}
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		// Gemini has been observed returning a bare top-level array despite
		// the schema — accept that shape too.
		var bare []DraftProgram
		if arrErr := json.Unmarshal([]byte(text), &bare); arrErr == nil {
			return bare, nil
		}
		return nil, fmt.Errorf("gemini generate program call: unmarshal structured output: %w", err)
	}
	return out.Programs, nil
}

func (p *geminiProvider) RecommendMeals(ctx context.Context, req RecommendRequest) ([]MealRecommendation, error) {
	client, err := genai.NewClient(ctx, &genai.ClientConfig{
		APIKey:  p.apiKey,
		Backend: genai.BackendGeminiAPI,
	})
	if err != nil {
		return nil, fmt.Errorf("gemini client: %w", err)
	}

	resp, err := client.Models.GenerateContent(ctx, p.model,
		[]*genai.Content{
			genai.NewContentFromParts([]*genai.Part{
				genai.NewPartFromText(mealRecommendPrompt(req)),
			}, genai.RoleUser),
		},
		&genai.GenerateContentConfig{
			ResponseMIMEType:   "application/json",
			ResponseJsonSchema: mealRecommendJSONSchema(),
		},
	)
	if err != nil {
		return nil, fmt.Errorf("gemini meal recommend call: %w", err)
	}

	text := resp.Text()
	if text == "" {
		return nil, fmt.Errorf("gemini meal recommend call: empty response text")
	}

	var out struct {
		Recommendations []MealRecommendation `json:"recommendations"`
	}
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		// Gemini has been observed returning the recommendations as a bare
		// top-level array despite the schema — accept that shape too.
		var bare []MealRecommendation
		if arrErr := json.Unmarshal([]byte(text), &bare); arrErr == nil {
			return bare, nil
		}
		return nil, fmt.Errorf("gemini meal recommend call: unmarshal structured output: %w", err)
	}
	return out.Recommendations, nil
}
