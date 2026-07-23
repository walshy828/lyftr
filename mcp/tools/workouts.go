package tools

import (
	"context"
	"fmt"
	"net/url"

	"github.com/Cawlumm/lyftr-mcp/client"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type listWorkoutsInput struct {
	Limit  int    `json:"limit,omitempty" jsonschema:"Maximum number of workouts to return (default 20)"`
	Offset int    `json:"offset,omitempty" jsonschema:"Number of workouts to skip, for pagination"`
	Q      string `json:"q,omitempty" jsonschema:"Free-text search over workout name/notes"`
}

type getWorkoutInput struct {
	ID int64 `json:"id" jsonschema:"The workout's id"`
}

type setInput struct {
	SetNumber int     `json:"set_number,omitempty" jsonschema:"1-based position of this set within the exercise"`
	Reps      int     `json:"reps,omitempty" jsonschema:"Repetitions completed"`
	Weight    float64 `json:"weight,omitempty" jsonschema:"Weight used, in the user's preferred unit"`
	Duration  int     `json:"duration,omitempty" jsonschema:"Duration in seconds, for timed exercises"`
	Distance  float64 `json:"distance,omitempty" jsonschema:"Distance covered, for cardio exercises"`
	RPE       float64 `json:"rpe,omitempty" jsonschema:"Rate of perceived exertion, 0-10"`
	IsWarmup  bool    `json:"is_warmup,omitempty" jsonschema:"Whether this is a warmup set (excluded from PR/volume calculations)"`
}

type workoutExerciseInput struct {
	ExerciseID int64      `json:"exercise_id" jsonschema:"id of the exercise (see list_exercises)"`
	OrderIndex int        `json:"order_index,omitempty" jsonschema:"Position of this exercise within the workout"`
	Notes      string     `json:"notes,omitempty" jsonschema:"Notes for this exercise in this workout"`
	Sets       []setInput `json:"sets,omitempty" jsonschema:"Sets performed for this exercise"`
}

type createWorkoutInput struct {
	Name      string                 `json:"name" jsonschema:"Workout name, e.g. 'Push Day'"`
	Notes     string                 `json:"notes,omitempty" jsonschema:"Free-text notes about the workout"`
	Duration  int                    `json:"duration,omitempty" jsonschema:"Duration in seconds"`
	Feeling   int                    `json:"feeling,omitempty" jsonschema:"Post-workout feeling: 0=unrated, 1=light, 2=moderate, 3=intense"`
	ProgramID *int64                 `json:"program_id,omitempty" jsonschema:"id of the program this workout was based on, if any"`
	Exercises []workoutExerciseInput `json:"exercises,omitempty" jsonschema:"Exercises performed, in order"`
}

type updateWorkoutInput struct {
	ID int64 `json:"id" jsonschema:"The workout's id"`
	createWorkoutInput
}

func registerWorkouts(server *mcp.Server, c *client.Client) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_workouts",
		Description: "List the user's logged workouts, most recent first.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in listWorkoutsInput) (*mcp.CallToolResult, any, error) {
		q := url.Values{}
		setIfPositive(q, "limit", in.Limit)
		setIfPositive(q, "offset", in.Offset)
		setIfNonEmpty(q, "q", in.Q)
		data, err := c.Get(ctx, "/workouts", q)
		return nil, data, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_workout",
		Description: "Get one workout, including its exercises and sets.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in getWorkoutInput) (*mcp.CallToolResult, any, error) {
		data, err := c.Get(ctx, fmt.Sprintf("/workouts/%d", in.ID), nil)
		return nil, data, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "create_workout",
		Description: "Log a completed workout with its exercises and sets.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in createWorkoutInput) (*mcp.CallToolResult, any, error) {
		data, err := c.Post(ctx, "/workouts", in)
		return nil, data, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "update_workout",
		Description: "Update an existing workout (replaces its exercises/sets with the given ones).",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in updateWorkoutInput) (*mcp.CallToolResult, any, error) {
		data, err := c.Put(ctx, fmt.Sprintf("/workouts/%d", in.ID), in.createWorkoutInput)
		return nil, data, err
	})
}
