package tools

import (
	"context"
	"net/url"

	"github.com/Cawlumm/lyftr-mcp/client"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type listBloodPressureInput struct {
	Limit int    `json:"limit,omitempty" jsonschema:"Maximum number of readings to return"`
	From  string `json:"from,omitempty" jsonschema:"Start date (YYYY-MM-DD or RFC3339), inclusive"`
	To    string `json:"to,omitempty" jsonschema:"End date (YYYY-MM-DD or RFC3339), inclusive"`
}

type logBloodPressureInput struct {
	Systolic  int    `json:"systolic" jsonschema:"Systolic pressure in mmHg (the top number)"`
	Diastolic int    `json:"diastolic" jsonschema:"Diastolic pressure in mmHg (the bottom number)"`
	Pulse     int    `json:"pulse,omitempty" jsonschema:"Pulse in beats per minute, if the cuff reported one"`
	Context   string `json:"context,omitempty" jsonschema:"When this was taken: morning, evening, post_workout, post_meal, stressed, or other"`
	Arm       string `json:"arm,omitempty" jsonschema:"Which arm: left or right"`
	Position  string `json:"position,omitempty" jsonschema:"Body position: seated, standing, or lying"`
	Rested    bool   `json:"rested,omitempty" jsonschema:"True if the user sat quietly for five minutes before measuring"`
	Notes     string `json:"notes,omitempty" jsonschema:"Notes for this reading"`
	TZOffset  int    `json:"tz_offset,omitempty" jsonschema:"Minutes east of UTC at capture time, so morning/evening rules work in the user's local time"`
	LoggedAt  string `json:"logged_at,omitempty" jsonschema:"RFC3339 timestamp; defaults to now. Multiple readings per day are expected and all are kept."`
}

func registerBloodPressure(server *mcp.Server, c *client.Client) {
	mcp.AddTool(server, &mcp.Tool{
		Name: "list_blood_pressure_logs",
		Description: "List the user's blood-pressure readings, most recent first. " +
			"Each reading carries a server-computed ACC/AHA category.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in listBloodPressureInput) (*mcp.CallToolResult, any, error) {
		q := url.Values{}
		setIfPositive(q, "limit", in.Limit)
		setIfNonEmpty(q, "from", in.From)
		setIfNonEmpty(q, "to", in.To)
		data, err := c.Get(ctx, "/blood-pressure", q)
		return nil, data, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name: "log_blood_pressure",
		Description: "Log a blood-pressure reading. Unlike weight, several readings per day are " +
			"expected and all are kept — the app groups readings taken within 15 minutes into one " +
			"averaged measurement occasion.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in logBloodPressureInput) (*mcp.CallToolResult, any, error) {
		data, err := c.Post(ctx, "/blood-pressure", in)
		return nil, data, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name: "get_blood_pressure_stats",
		Description: "Get the full blood-pressure picture: 7/30/90-day averages with their ACC/AHA " +
			"categories, the daily series, the fitted trend, and guidance on how and when the user " +
			"should be measuring. Categories are based on averages, not any single reading.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ any) (*mcp.CallToolResult, any, error) {
		data, err := c.Get(ctx, "/blood-pressure/stats", nil)
		return nil, data, err
	})
}
