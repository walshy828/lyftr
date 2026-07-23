package tools

import (
	"context"
	"net/url"

	"github.com/Cawlumm/lyftr-mcp/client"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type listFoodInput struct {
	Date string `json:"date,omitempty" jsonschema:"Calendar day (YYYY-MM-DD) to list; defaults to today"`
}

type logFoodInput struct {
	Name        string  `json:"name" jsonschema:"Food name"`
	Brand       string  `json:"brand,omitempty" jsonschema:"Brand name"`
	Meal        string  `json:"meal" jsonschema:"One of: breakfast, lunch, dinner, snacks"`
	Calories    float64 `json:"calories,omitempty" jsonschema:"Calories for the logged serving(s)"`
	Protein     float64 `json:"protein,omitempty" jsonschema:"Protein in grams"`
	Carbs       float64 `json:"carbs,omitempty" jsonschema:"Carbohydrates in grams"`
	Fat         float64 `json:"fat,omitempty" jsonschema:"Fat in grams"`
	Fiber       float64 `json:"fiber,omitempty" jsonschema:"Fiber in grams"`
	Sugar       float64 `json:"sugar,omitempty" jsonschema:"Sugar in grams"`
	Sodium      float64 `json:"sodium,omitempty" jsonschema:"Sodium in milligrams"`
	Cholesterol float64 `json:"cholesterol,omitempty" jsonschema:"Cholesterol in milligrams"`
	Servings    float64 `json:"servings,omitempty" jsonschema:"Number of servings logged (default 1)"`
	ServingSize string  `json:"serving_size,omitempty" jsonschema:"Human-readable serving size, e.g. '200g'"`
	LoggedAt    string  `json:"logged_at,omitempty" jsonschema:"RFC3339 timestamp; defaults to now"`
}

type foodStatsInput struct {
	Date string `json:"date,omitempty" jsonschema:"Calendar day (YYYY-MM-DD) to summarize; defaults to today"`
}

type foodHistoryInput struct {
	Days int `json:"days,omitempty" jsonschema:"Number of trailing days to include (default 30)"`
}

type searchFoodInput struct {
	Q     string `json:"q" jsonschema:"Free-text food search query"`
	Limit int    `json:"limit,omitempty" jsonschema:"Maximum number of results (default 20)"`
}

type parseMealInput struct {
	Description string `json:"description" jsonschema:"Free-text description of a meal, e.g. '200g grilled chicken breast and a cup of rice'"`
}

func registerFood(server *mcp.Server, c *client.Client) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_food_logs",
		Description: "List the user's logged food entries for a day (defaults to today).",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in listFoodInput) (*mcp.CallToolResult, any, error) {
		q := url.Values{}
		setIfNonEmpty(q, "date", in.Date)
		data, err := c.Get(ctx, "/food", q)
		return nil, data, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "log_food",
		Description: "Log a food entry with known macros. For a free-text meal description without known macros, use parse_meal first.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in logFoodInput) (*mcp.CallToolResult, any, error) {
		data, err := c.Post(ctx, "/food", in)
		return nil, data, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_food_stats",
		Description: "Get daily nutrition totals (calories, protein, carbs, fat, etc.) for a day, defaults to today.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in foodStatsInput) (*mcp.CallToolResult, any, error) {
		q := url.Values{}
		setIfNonEmpty(q, "date", in.Date)
		data, err := c.Get(ctx, "/food/stats", q)
		return nil, data, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_food_history",
		Description: "Get daily nutrition totals over a trailing window of days, for trend analysis.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in foodHistoryInput) (*mcp.CallToolResult, any, error) {
		q := url.Values{}
		setIfPositive(q, "days", in.Days)
		data, err := c.Get(ctx, "/food/history", q)
		return nil, data, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "search_food",
		Description: "Search the food database for items matching a query, to find macros before logging.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in searchFoodInput) (*mcp.CallToolResult, any, error) {
		q := url.Values{}
		q.Set("q", in.Q)
		setIfPositive(q, "limit", in.Limit)
		data, err := c.Get(ctx, "/food/search", q)
		return nil, data, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "parse_meal",
		Description: "Parse a free-text meal description into structured food items with estimated macros, ready to log with log_food.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in parseMealInput) (*mcp.CallToolResult, any, error) {
		data, err := c.Post(ctx, "/food/parse-meal", in)
		return nil, data, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_saved_foods",
		Description: "List the user's saved/favorite foods, for quick re-logging.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ any) (*mcp.CallToolResult, any, error) {
		data, err := c.Get(ctx, "/food/saved", nil)
		return nil, data, err
	})
}
