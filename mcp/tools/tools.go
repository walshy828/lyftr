// Package tools registers the Lyftr MCP tools: one per REST endpoint exposed
// to the assistant, grouped by domain file. Every tool returns the backend's
// raw JSON response as-is (Out = json.RawMessage) — the SDK auto-populates
// CallToolResult.Content/StructuredContent from it, and auto-wraps a returned
// error as a tool-level error, so handlers stay a thin params -> client call.
package tools

import (
	"net/url"
	"strconv"

	"github.com/Cawlumm/lyftr-mcp/client"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Register adds every Lyftr tool to server, calling the backend through c.
func Register(server *mcp.Server, c *client.Client) {
	registerUser(server, c)
	registerWorkouts(server, c)
	registerWeight(server, c)
	registerFood(server, c)
	registerExercises(server, c)
	registerPrograms(server, c)
}

// setIfPositive adds key=v to q when v is above zero, so an omitted (zero
// value) optional int argument doesn't override the backend's own default.
func setIfPositive(q url.Values, key string, v int) {
	if v > 0 {
		q.Set(key, strconv.Itoa(v))
	}
}

func setIfNonEmpty(q url.Values, key, v string) {
	if v != "" {
		q.Set(key, v)
	}
}
