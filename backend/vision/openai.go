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
// (anthropicModel-equivalent constant below is a placeholder).
const openAIModel = "gpt-4o"

type openAIProvider struct {
	client openai.Client
}

func newOpenAIProvider(apiKey string) *openAIProvider {
	return &openAIProvider{client: openai.NewClient(option.WithAPIKey(apiKey))}
}

func (p *openAIProvider) AnalyzeLabel(ctx context.Context, imageBase64, mediaType string) (NutritionExtraction, error) {
	dataURI := fmt.Sprintf("data:%s;base64,%s", mediaType, imageBase64)

	// TODO(verify): exact Go binding for a multi-part user message (text +
	// image_url) and for response_format / structured-output JSON schema mode
	// — the shapes below follow the Chat Completions wire format but the Go
	// SDK's typed constructors/param names must be confirmed via `go doc
	// github.com/openai/openai-go` or a compile-fix loop.
	resp, err := p.client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: openAIModel,
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
