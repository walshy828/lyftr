package vision

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
)

// TODO(verify): confirm github.com/openai/openai-go is the current, maintained
// official Go SDK at implementation time (vs. the community
// github.com/sashabaranov/go-openai). If it isn't, swap the import and the
// call shape below — the rest of this file's structure (build a data: URI
// image part + a text part, request JSON-schema structured output, unmarshal
// the first choice's message content) should carry over either way.
//
// TODO(verify): confirm the current gpt-4o-class vision+JSON-mode model string
// (anthropicModel-equivalent constant below is a placeholder). Overridable
// per-deployment via the OPENAI_MODEL env var.
const openAIModel = "gpt-4o"

type openAIProvider struct {
	client openai.Client
	model  string
}

func newOpenAIProvider(apiKey, model string) *openAIProvider {
	if model == "" {
		model = openAIModel
	}
	return &openAIProvider{client: openai.NewClient(option.WithAPIKey(apiKey)), model: model}
}

func (p *openAIProvider) AnalyzeLabel(ctx context.Context, imageBase64, mediaType string) (NutritionExtraction, error) {
	dataURI := fmt.Sprintf("data:%s;base64,%s", mediaType, imageBase64)

	// TODO(verify): exact Go binding for a multi-part user message (text +
	// image_url) and for response_format / structured-output JSON schema mode
	// — the shapes below follow the Chat Completions wire format but the Go
	// SDK's typed constructors/param names must be confirmed via `go doc
	// github.com/openai/openai-go` or a compile-fix loop.
	resp, err := p.client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: p.model,
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.UserMessage([]openai.ChatCompletionContentPartUnionParam{
				openai.TextContentPart(extractionPrompt),
				openai.ImageContentPart(openai.ChatCompletionContentPartImageImageURLParam{
					URL: dataURI,
				}),
			}),
		},
		ResponseFormat: openai.ChatCompletionNewParamsResponseFormatUnion{
			OfJSONSchema: &openai.ResponseFormatJSONSchemaParam{
				JSONSchema: openai.ResponseFormatJSONSchemaJSONSchemaParam{
					Name:   "nutrition_extraction",
					Schema: nutritionJSONSchema(),
					Strict: openai.Bool(true),
				},
			},
		},
	})
	if err != nil {
		return NutritionExtraction{}, fmt.Errorf("openai vision call: %w", err)
	}
	if len(resp.Choices) == 0 {
		return NutritionExtraction{}, fmt.Errorf("openai vision call: no choices in response")
	}

	var out NutritionExtraction
	if err := json.Unmarshal([]byte(resp.Choices[0].Message.Content), &out); err != nil {
		return NutritionExtraction{}, fmt.Errorf("openai vision call: unmarshal structured output: %w", err)
	}
	return out, nil
}

func (p *openAIProvider) ParseMeal(ctx context.Context, description string) ([]MealItem, error) {
	resp, err := p.client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: p.model,
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.UserMessage(mealParsePrompt + description),
		},
		ResponseFormat: openai.ChatCompletionNewParamsResponseFormatUnion{
			OfJSONSchema: &openai.ResponseFormatJSONSchemaParam{
				JSONSchema: openai.ResponseFormatJSONSchemaJSONSchemaParam{
					Name:   "meal_parse",
					Schema: mealParseJSONSchema(),
					Strict: openai.Bool(true),
				},
			},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("openai meal parse call: %w", err)
	}
	if len(resp.Choices) == 0 {
		return nil, fmt.Errorf("openai meal parse call: no choices in response")
	}

	var out struct {
		Items []MealItem `json:"items"`
	}
	if err := json.Unmarshal([]byte(resp.Choices[0].Message.Content), &out); err != nil {
		return nil, fmt.Errorf("openai meal parse call: unmarshal structured output: %w", err)
	}
	return out.Items, nil
}

func (p *openAIProvider) AnalyzeMealPhoto(ctx context.Context, imageBase64, mediaType, description string) (MealPhotoAnalysis, error) {
	dataURI := fmt.Sprintf("data:%s;base64,%s", mediaType, imageBase64)

	resp, err := p.client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: p.model,
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.UserMessage([]openai.ChatCompletionContentPartUnionParam{
				openai.TextContentPart(mealPhotoAnalysisPromptWithDescription(description)),
				openai.ImageContentPart(openai.ChatCompletionContentPartImageImageURLParam{
					URL: dataURI,
				}),
			}),
		},
		ResponseFormat: openai.ChatCompletionNewParamsResponseFormatUnion{
			OfJSONSchema: &openai.ResponseFormatJSONSchemaParam{
				JSONSchema: openai.ResponseFormatJSONSchemaJSONSchemaParam{
					Name:   "meal_photo_analysis",
					Schema: mealPhotoAnalysisJSONSchema(),
					Strict: openai.Bool(true),
				},
			},
		},
	})
	if err != nil {
		return MealPhotoAnalysis{}, fmt.Errorf("openai meal photo call: %w", err)
	}
	if len(resp.Choices) == 0 {
		return MealPhotoAnalysis{}, fmt.Errorf("openai meal photo call: no choices in response")
	}

	var out MealPhotoAnalysis
	if err := json.Unmarshal([]byte(resp.Choices[0].Message.Content), &out); err != nil {
		return MealPhotoAnalysis{}, fmt.Errorf("openai meal photo call: unmarshal structured output: %w", err)
	}
	return out, nil
}

func (p *openAIProvider) GenerateProgram(ctx context.Context, req GenerateProgramRequest) ([]DraftProgram, error) {
	resp, err := p.client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: p.model,
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.UserMessage(generateProgramPrompt(req)),
		},
		ResponseFormat: openai.ChatCompletionNewParamsResponseFormatUnion{
			OfJSONSchema: &openai.ResponseFormatJSONSchemaParam{
				JSONSchema: openai.ResponseFormatJSONSchemaJSONSchemaParam{
					Name:   "generate_program",
					Schema: draftProgramJSONSchema(),
					Strict: openai.Bool(true),
				},
			},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("openai generate program call: %w", err)
	}
	if len(resp.Choices) == 0 {
		return nil, fmt.Errorf("openai generate program call: no choices in response")
	}

	var out struct {
		Programs []DraftProgram `json:"programs"`
	}
	if err := json.Unmarshal([]byte(resp.Choices[0].Message.Content), &out); err != nil {
		return nil, fmt.Errorf("openai generate program call: unmarshal structured output: %w", err)
	}
	return out.Programs, nil
}

func (p *openAIProvider) RecommendMeals(ctx context.Context, req RecommendRequest) ([]MealRecommendation, error) {
	resp, err := p.client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: p.model,
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.UserMessage(mealRecommendPrompt(req)),
		},
		ResponseFormat: openai.ChatCompletionNewParamsResponseFormatUnion{
			OfJSONSchema: &openai.ResponseFormatJSONSchemaParam{
				JSONSchema: openai.ResponseFormatJSONSchemaJSONSchemaParam{
					Name:   "meal_recommend",
					Schema: mealRecommendJSONSchema(),
					Strict: openai.Bool(true),
				},
			},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("openai meal recommend call: %w", err)
	}
	if len(resp.Choices) == 0 {
		return nil, fmt.Errorf("openai meal recommend call: no choices in response")
	}

	var out struct {
		Recommendations []MealRecommendation `json:"recommendations"`
	}
	if err := json.Unmarshal([]byte(resp.Choices[0].Message.Content), &out); err != nil {
		return nil, fmt.Errorf("openai meal recommend call: unmarshal structured output: %w", err)
	}
	return out.Recommendations, nil
}
