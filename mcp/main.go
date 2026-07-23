// Command lyftr-mcp is a local stdio MCP server that lets an MCP client (e.g.
// Claude Desktop or Claude Code) read and write a Lyftr user's workouts,
// weight, food, exercises, and programs through the existing REST API,
// authenticating with a personal access token instead of an interactive login.
package main

import (
	"context"
	"log"
	"os"

	"github.com/Cawlumm/lyftr-mcp/client"
	"github.com/Cawlumm/lyftr-mcp/tools"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func main() {
	baseURL := os.Getenv("LYFTR_API_URL")
	if baseURL == "" {
		log.Fatal("LYFTR_API_URL is required, e.g. http://localhost:3000/api/v1")
	}
	token := os.Getenv("LYFTR_TOKEN")
	if token == "" {
		log.Fatal("LYFTR_TOKEN is required — create one in the Lyftr web app under Settings > Personal access tokens")
	}

	c := client.New(baseURL, token)

	server := mcp.NewServer(&mcp.Implementation{Name: "lyftr", Version: "0.1.0"}, nil)
	tools.Register(server, c)

	if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		log.Fatalf("lyftr-mcp: %v", err)
	}
}
