package tools

import (
	"context"
	"fmt"
	"net/url"

	"github.com/Cawlumm/lyftr-mcp/client"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type listCardioInput struct {
	Limit  int `json:"limit,omitempty" jsonschema:"Maximum number of sessions to return"`
	Offset int `json:"offset,omitempty" jsonschema:"Number of sessions to skip, for pagination"`
}

type getCardioInput struct {
	ID int64 `json:"id" jsonschema:"Cardio session id"`
}

func registerCardio(server *mcp.Server, c *client.Client) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_cardio_sessions",
		Description: "List the user's cardio sessions (runs/rides/walks/etc.) imported from a companion device's health platform, most recent first.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in listCardioInput) (*mcp.CallToolResult, any, error) {
		q := url.Values{}
		setIfPositive(q, "limit", in.Limit)
		setIfPositive(q, "offset", in.Offset)
		data, err := c.Get(ctx, "/cardio", q)
		return nil, data, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_cardio_session",
		Description: "Get one cardio session by id.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in getCardioInput) (*mcp.CallToolResult, any, error) {
		data, err := c.Get(ctx, fmt.Sprintf("/cardio/%d", in.ID), nil)
		return nil, data, err
	})
}
