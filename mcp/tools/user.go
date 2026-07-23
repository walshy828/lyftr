package tools

import (
	"context"
	"encoding/json"

	"github.com/Cawlumm/lyftr-mcp/client"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func registerUser(server *mcp.Server, c *client.Client) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_me",
		Description: "Get the current user's profile (id, email, member-since date).",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ any) (*mcp.CallToolResult, json.RawMessage, error) {
		data, err := c.Get(ctx, "/me", nil)
		return nil, data, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_settings",
		Description: "Get the user's preferences and daily nutrition targets (weight unit, calorie/protein/carb/fat/cholesterol/sodium targets, food allergies/dislikes/likes).",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ any) (*mcp.CallToolResult, json.RawMessage, error) {
		data, err := c.Get(ctx, "/settings", nil)
		return nil, data, err
	})
}
