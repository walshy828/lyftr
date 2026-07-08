package vision

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

// anthropicModel is the current Opus-tier model — no date suffix.
const anthropicModel = "claude-opus-4-8"

type anthropicProvider struct {
	client anthropic.Client
}

func newAnthropicProvider(apiKey string) *anthropicProvider {
	return &anthropicProvider{client: anthropic.NewClient(option.WithAPIKey(apiKey))}
}

func (p *anthropicProvider) AnalyzeLabel(ctx context.Context, imageBase64, mediaType string) (NutritionExtraction, error) {
	resp, err := p.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     anthropicModel,
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
