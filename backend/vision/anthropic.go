package vision

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

// anthropicModel is the default Opus-tier model — no date suffix. Overridable
// per-deployment via the ANTHROPIC_MODEL env var.
const anthropicModel = "claude-opus-4-8"

type anthropicProvider struct {
	client anthropic.Client
	model  string
}

func newAnthropicProvider(apiKey, model string) *anthropicProvider {
	if model == "" {
		model = anthropicModel
	}
	return &anthropicProvider{client: anthropic.NewClient(option.WithAPIKey(apiKey)), model: model}
}

func (p *anthropicProvider) AnalyzeLabel(ctx context.Context, imageBase64, mediaType string) (NutritionExtraction, error) {
	resp, err := p.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     p.model,
		MaxTokens: 1024,
		OutputConfig: anthropic.OutputConfigParam{
			Effort: anthropic.OutputConfigEffortLow,
			Format: anthropic.JSONOutputFormatParam{
				Schema: nutritionJSONSchema(),
			},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(
				anthropic.NewImageBlockBase64(mediaType, imageBase64),
				anthropic.NewTextBlock(extractionPrompt),
			),
		},
	})
	if err != nil {
		return NutritionExtraction{}, fmt.Errorf("anthropic vision call: %w", err)
	}

	var text string
	for _, block := range resp.Content {
		if tb, ok := block.AsAny().(anthropic.TextBlock); ok {
			text = tb.Text
			break
		}
	}
	if text == "" {
		return NutritionExtraction{}, fmt.Errorf("anthropic vision call: no text content in response")
	}

	var out NutritionExtraction
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		return NutritionExtraction{}, fmt.Errorf("anthropic vision call: unmarshal structured output: %w", err)
	}
	return out, nil
}

func (p *anthropicProvider) ParseMeal(ctx context.Context, description string) ([]MealItem, error) {
	resp, err := p.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     p.model,
		MaxTokens: 1024,
		OutputConfig: anthropic.OutputConfigParam{
			Effort: anthropic.OutputConfigEffortLow,
			Format: anthropic.JSONOutputFormatParam{
				Schema: mealParseJSONSchema(),
			},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(
				anthropic.NewTextBlock(mealParsePrompt + description),
			),
		},
	})
	if err != nil {
		return nil, fmt.Errorf("anthropic meal parse call: %w", err)
	}

	var text string
	for _, block := range resp.Content {
		if tb, ok := block.AsAny().(anthropic.TextBlock); ok {
			text = tb.Text
			break
		}
	}
	if text == "" {
		return nil, fmt.Errorf("anthropic meal parse call: no text content in response")
	}

	var out struct {
		Items []MealItem `json:"items"`
	}
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		return nil, fmt.Errorf("anthropic meal parse call: unmarshal structured output: %w", err)
	}
	return out.Items, nil
}

func (p *anthropicProvider) AnalyzeMealPhoto(ctx context.Context, imageBase64, mediaType, description string) (MealPhotoAnalysis, error) {
	resp, err := p.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model: p.model,
		// 1536: per-item confidence/portion_reasoning text adds tokens
		// beyond what ParseMeal's 1024 needs.
		MaxTokens: 1536,
		OutputConfig: anthropic.OutputConfigParam{
			Effort: anthropic.OutputConfigEffortLow,
			Format: anthropic.JSONOutputFormatParam{
				Schema: mealPhotoAnalysisJSONSchema(),
			},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(
				anthropic.NewImageBlockBase64(mediaType, imageBase64),
				anthropic.NewTextBlock(mealPhotoAnalysisPromptWithDescription(description)),
			),
		},
	})
	if err != nil {
		return MealPhotoAnalysis{}, fmt.Errorf("anthropic meal photo call: %w", err)
	}

	var text string
	for _, block := range resp.Content {
		if tb, ok := block.AsAny().(anthropic.TextBlock); ok {
			text = tb.Text
			break
		}
	}
	if text == "" {
		return MealPhotoAnalysis{}, fmt.Errorf("anthropic meal photo call: no text content in response")
	}

	var out MealPhotoAnalysis
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		return MealPhotoAnalysis{}, fmt.Errorf("anthropic meal photo call: unmarshal structured output: %w", err)
	}
	return out, nil
}

func (p *anthropicProvider) GenerateProgram(ctx context.Context, req GenerateProgramRequest) ([]DraftProgram, error) {
	resp, err := p.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model: p.model,
		// 4096: a multi-day request returns several full exercise/set lists,
		// larger than any single meal-related response.
		MaxTokens: 4096,
		OutputConfig: anthropic.OutputConfigParam{
			Effort: anthropic.OutputConfigEffortLow,
			Format: anthropic.JSONOutputFormatParam{
				Schema: draftProgramJSONSchema(),
			},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(
				anthropic.NewTextBlock(generateProgramPrompt(req)),
			),
		},
	})
	if err != nil {
		return nil, fmt.Errorf("anthropic generate program call: %w", err)
	}

	var text string
	for _, block := range resp.Content {
		if tb, ok := block.AsAny().(anthropic.TextBlock); ok {
			text = tb.Text
			break
		}
	}
	if text == "" {
		return nil, fmt.Errorf("anthropic generate program call: no text content in response")
	}

	var out struct {
		Programs []DraftProgram `json:"programs"`
	}
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		return nil, fmt.Errorf("anthropic generate program call: unmarshal structured output: %w", err)
	}
	return out.Programs, nil
}

func (p *anthropicProvider) GenerateWeightPlan(ctx context.Context, req GenerateWeightPlanRequest) (DraftWeightPlan, error) {
	resp, err := p.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model: p.model,
		// Raised from 2048: the response now carries the structured `detail`
		// sections on top of a per-week trajectory that can run 100+ entries.
		MaxTokens: 3072,
		OutputConfig: anthropic.OutputConfigParam{
			Effort: anthropic.OutputConfigEffortLow,
			Format: anthropic.JSONOutputFormatParam{
				Schema: weightPlanJSONSchema(),
			},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(
				anthropic.NewTextBlock(weightPlanPrompt(req)),
			),
		},
	})
	if err != nil {
		return DraftWeightPlan{}, fmt.Errorf("anthropic generate weight plan call: %w", err)
	}

	var text string
	for _, block := range resp.Content {
		if tb, ok := block.AsAny().(anthropic.TextBlock); ok {
			text = tb.Text
			break
		}
	}
	if text == "" {
		return DraftWeightPlan{}, fmt.Errorf("anthropic generate weight plan call: no text content in response")
	}

	var out DraftWeightPlan
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		return DraftWeightPlan{}, fmt.Errorf("anthropic generate weight plan call: unmarshal structured output: %w", err)
	}
	return out, nil
}

func (p *anthropicProvider) GenerateProgressCheckin(ctx context.Context, req ProgressCheckinRequest) (ProgressCheckinReport, error) {
	resp, err := p.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model: p.model,
		// The largest response in this package: two assessments, up to five
		// benchmark rows, three separate lists, and an outlook — all prose.
		MaxTokens: 4096,
		OutputConfig: anthropic.OutputConfigParam{
			// Higher effort than the other calls: this one has to weigh the
			// overall trend against the recent one and recall population
			// norms, not just reformat numbers it was handed.
			Effort: anthropic.OutputConfigEffortMedium,
			Format: anthropic.JSONOutputFormatParam{
				Schema: progressCheckinJSONSchema(),
			},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(
				anthropic.NewTextBlock(progressCheckinPrompt(req)),
			),
		},
	})
	if err != nil {
		return ProgressCheckinReport{}, fmt.Errorf("anthropic progress checkin call: %w", err)
	}

	var text string
	for _, block := range resp.Content {
		if tb, ok := block.AsAny().(anthropic.TextBlock); ok {
			text = tb.Text
			break
		}
	}
	if text == "" {
		return ProgressCheckinReport{}, fmt.Errorf("anthropic progress checkin call: no text content in response")
	}

	var out ProgressCheckinReport
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		return ProgressCheckinReport{}, fmt.Errorf("anthropic progress checkin call: unmarshal structured output: %w", err)
	}
	return out, nil
}

func (p *anthropicProvider) GenerateMotivationNote(ctx context.Context, req MotivationNoteRequest) (string, error) {
	resp, err := p.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     p.model,
		MaxTokens: 512,
		OutputConfig: anthropic.OutputConfigParam{
			Effort: anthropic.OutputConfigEffortLow,
			Format: anthropic.JSONOutputFormatParam{
				Schema: motivationNoteJSONSchema(),
			},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(
				anthropic.NewTextBlock(motivationNotePrompt(req)),
			),
		},
	})
	if err != nil {
		return "", fmt.Errorf("anthropic motivation note call: %w", err)
	}

	var text string
	for _, block := range resp.Content {
		if tb, ok := block.AsAny().(anthropic.TextBlock); ok {
			text = tb.Text
			break
		}
	}
	if text == "" {
		return "", fmt.Errorf("anthropic motivation note call: no text content in response")
	}

	var out struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		return "", fmt.Errorf("anthropic motivation note call: unmarshal structured output: %w", err)
	}
	return out.Message, nil
}

func (p *anthropicProvider) RecommendMeals(ctx context.Context, req RecommendRequest) ([]MealRecommendation, error) {
	resp, err := p.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model: p.model,
		// 2048: two-to-three recommendations with full item lists run longer
		// than a single parsed meal (1024).
		MaxTokens: 2048,
		OutputConfig: anthropic.OutputConfigParam{
			Effort: anthropic.OutputConfigEffortLow,
			Format: anthropic.JSONOutputFormatParam{
				Schema: mealRecommendJSONSchema(),
			},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(
				anthropic.NewTextBlock(mealRecommendPrompt(req)),
			),
		},
	})
	if err != nil {
		return nil, fmt.Errorf("anthropic meal recommend call: %w", err)
	}

	var text string
	for _, block := range resp.Content {
		if tb, ok := block.AsAny().(anthropic.TextBlock); ok {
			text = tb.Text
			break
		}
	}
	if text == "" {
		return nil, fmt.Errorf("anthropic meal recommend call: no text content in response")
	}

	var out struct {
		Recommendations []MealRecommendation `json:"recommendations"`
	}
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		return nil, fmt.Errorf("anthropic meal recommend call: unmarshal structured output: %w", err)
	}
	return out.Recommendations, nil
}

func (p *anthropicProvider) GenerateBPInsight(ctx context.Context, req BPInsightRequest) (BPInsightReport, error) {
	resp, err := p.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model: p.model,
		// Two assessments, a contributor table, an action plan, measurement
		// tips and an outlook — comparable in size to the progress check-in.
		MaxTokens: 3072,
		OutputConfig: anthropic.OutputConfigParam{
			// Medium, like the check-in: this call has to reason across four
			// separate data streams (pressure, weight, training, sodium) and
			// judge which links the data actually supports, rather than
			// reformatting numbers it was handed.
			Effort: anthropic.OutputConfigEffortMedium,
			Format: anthropic.JSONOutputFormatParam{
				Schema: bpInsightJSONSchema(),
			},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(
				anthropic.NewTextBlock(bpInsightPrompt(req)),
			),
		},
	})
	if err != nil {
		return BPInsightReport{}, fmt.Errorf("anthropic bp insight call: %w", err)
	}

	var text string
	for _, block := range resp.Content {
		if tb, ok := block.AsAny().(anthropic.TextBlock); ok {
			text = tb.Text
			break
		}
	}
	if text == "" {
		return BPInsightReport{}, fmt.Errorf("anthropic bp insight call: no text content in response")
	}

	var out BPInsightReport
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		return BPInsightReport{}, fmt.Errorf("anthropic bp insight call: unmarshal structured output: %w", err)
	}
	return out, nil
}
