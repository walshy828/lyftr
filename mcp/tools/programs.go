package tools

import (
	"context"
	"fmt"
	"net/url"

	"github.com/Cawlumm/lyftr-mcp/client"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type listProgramsInput struct {
	Limit  int    `json:"limit,omitempty" jsonschema:"Maximum number of programs to return"`
	Offset int    `json:"offset,omitempty" jsonschema:"Number of programs to skip, for pagination"`
	Q      string `json:"q,omitempty" jsonschema:"Free-text search over program name/notes"`
}

type getProgramInput struct {
	ID int64 `json:"id" jsonschema:"The program's id"`
}

type programSetInput struct {
	SetNumber    int     `json:"set_number,omitempty" jsonschema:"1-based position of this set within the exercise"`
	TargetReps   int     `json:"target_reps,omitempty" jsonschema:"Target repetitions"`
	TargetWeight float64 `json:"target_weight,omitempty" jsonschema:"Target weight, in the user's preferred unit"`
}

type programExerciseInput struct {
	ExerciseID  int64             `json:"exercise_id" jsonschema:"id of the exercise (see list_exercises)"`
	Notes       string            `json:"notes,omitempty" jsonschema:"Notes for this exercise in the program"`
	RestSeconds int               `json:"rest_seconds,omitempty" jsonschema:"Rest time between sets, in seconds (0 disables the rest timer)"`
	Sets        []programSetInput `json:"sets,omitempty" jsonschema:"Target sets for this exercise"`
}

type createProgramInput struct {
	Name      string                 `json:"name" jsonschema:"Program name, e.g. 'Push Pull Legs — Day 1'"`
	Notes     string                 `json:"notes,omitempty" jsonschema:"Free-text notes about the program"`
	Exercises []programExerciseInput `json:"exercises,omitempty" jsonschema:"Exercises in the program, in order"`
}

type updateProgramInput struct {
	ID int64 `json:"id" jsonschema:"The program's id"`
	createProgramInput
}

func registerPrograms(server *mcp.Server, c *client.Client) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_programs",
		Description: "List the user's workout programs.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in listProgramsInput) (*mcp.CallToolResult, any, error) {
		q := url.Values{}
		setIfPositive(q, "limit", in.Limit)
		setIfPositive(q, "offset", in.Offset)
		setIfNonEmpty(q, "q", in.Q)
		data, err := c.Get(ctx, "/programs", q)
		return nil, data, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_program",
		Description: "Get one program, including its exercises and target sets.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in getProgramInput) (*mcp.CallToolResult, any, error) {
		data, err := c.Get(ctx, fmt.Sprintf("/programs/%d", in.ID), nil)
		return nil, data, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "create_program",
		Description: "Create a new workout program (e.g. a multi-day split) with its exercises and target sets.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in createProgramInput) (*mcp.CallToolResult, any, error) {
		data, err := c.Post(ctx, "/programs", in)
		return nil, data, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "update_program",
		Description: "Update an existing program (replaces its exercises/target sets with the given ones).",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in updateProgramInput) (*mcp.CallToolResult, any, error) {
		data, err := c.Put(ctx, fmt.Sprintf("/programs/%d", in.ID), in.createProgramInput)
		return nil, data, err
	})
}
