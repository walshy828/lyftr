package tools

import (
	"context"
	"encoding/json"
	"net/url"

	"github.com/Cawlumm/lyftr-mcp/client"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type listWeightInput struct {
	Limit int    `json:"limit,omitempty" jsonschema:"Maximum number of entries to return"`
	From  string `json:"from,omitempty" jsonschema:"Start date (YYYY-MM-DD or RFC3339), inclusive"`
	To    string `json:"to,omitempty" jsonschema:"End date (YYYY-MM-DD or RFC3339), inclusive"`
}

type logWeightInput struct {
	Weight   float64 `json:"weight" jsonschema:"Body weight, in the user's preferred unit"`
	Notes    string  `json:"notes,omitempty" jsonschema:"Notes for this entry"`
	LoggedAt string  `json:"logged_at,omitempty" jsonschema:"RFC3339 timestamp; defaults to now. One entry per calendar day — logging again the same day updates it."`
}

func registerWeight(server *mcp.Server, c *client.Client) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_weight_logs",
		Description: "List the user's body-weight log entries, most recent first.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in listWeightInput) (*mcp.CallToolResult, json.RawMessage, error) {
		q := url.Values{}
		setIfPositive(q, "limit", in.Limit)
		setIfNonEmpty(q, "from", in.From)
		setIfNonEmpty(q, "to", in.To)
		data, err := c.Get(ctx, "/weight", q)
		return nil, data, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "log_weight",
		Description: "Log the user's body weight for a day (one entry per calendar day; logging again the same day overwrites it).",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in logWeightInput) (*mcp.CallToolResult, json.RawMessage, error) {
		data, err := c.Post(ctx, "/weight", in)
		return nil, data, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_weight_stats",
		Description: "Get summary weight stats: latest, starting, min, max, average, and 7/30-day change.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ any) (*mcp.CallToolResult, json.RawMessage, error) {
		data, err := c.Get(ctx, "/weight/stats", nil)
		return nil, data, err
	})
}
