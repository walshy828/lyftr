package tools

import (
	"context"
	"fmt"
	"net/url"

	"github.com/Cawlumm/lyftr-mcp/client"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type listExercisesInput struct {
	Q           string `json:"q,omitempty" jsonschema:"Free-text search over exercise name"`
	MuscleGroup string `json:"muscle_group,omitempty" jsonschema:"Filter by primary muscle group"`
	Category    string `json:"category,omitempty" jsonschema:"Filter by category, e.g. strength, cardio"`
	Equipment   string `json:"equipment,omitempty" jsonschema:"Filter by required equipment"`
}

type exerciseIDInput struct {
	ID int64 `json:"id" jsonschema:"The exercise's id (see list_exercises)"`
}

type exerciseHistoryInput struct {
	ID    int64 `json:"id" jsonschema:"The exercise's id"`
	Limit int   `json:"limit,omitempty" jsonschema:"Maximum number of history points to return (default 20)"`
}

func registerExercises(server *mcp.Server, c *client.Client) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_exercises",
		Description: "List/search the exercise library (read-only reference data shared across all users).",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in listExercisesInput) (*mcp.CallToolResult, any, error) {
		q := url.Values{}
		setIfNonEmpty(q, "q", in.Q)
		setIfNonEmpty(q, "muscle_group", in.MuscleGroup)
		setIfNonEmpty(q, "category", in.Category)
		setIfNonEmpty(q, "equipment", in.Equipment)
		data, err := c.Get(ctx, "/exercises", q)
		return nil, data, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_exercise_prs",
		Description: "Get the user's personal records (best weight/reps/etc.) for an exercise.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in exerciseIDInput) (*mcp.CallToolResult, any, error) {
		data, err := c.Get(ctx, fmt.Sprintf("/exercises/%d/prs", in.ID), nil)
		return nil, data, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_exercise_history",
		Description: "Get the user's historical performance (sets/weights over time) for an exercise.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in exerciseHistoryInput) (*mcp.CallToolResult, any, error) {
		q := url.Values{}
		setIfPositive(q, "limit", in.Limit)
		data, err := c.Get(ctx, fmt.Sprintf("/exercises/%d/history", in.ID), q)
		return nil, data, err
	})
}
