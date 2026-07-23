// Command lyftr-mcp is an MCP server that lets an MCP client (e.g. Claude
// Desktop or Claude Code) read and write a Lyftr user's workouts, weight,
// food, exercises, and programs through the existing REST API,
// authenticating with a personal access token instead of an interactive
// login.
//
// It runs in one of two modes, selected by MCP_TRANSPORT:
//   - "stdio" (default): a local subprocess an MCP client launches directly.
//   - "http": a long-running network service (e.g. alongside the backend in
//     Docker), for clients that aren't on the same machine. Every request
//     must carry the same personal access token as a bearer header — see
//     README.md.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strings"

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

	switch os.Getenv("MCP_TRANSPORT") {
	case "http":
		runHTTP(server, token)
	default:
		if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
			log.Fatalf("lyftr-mcp: %v", err)
		}
	}
}

// runHTTP serves MCP over Streamable HTTP so a client that isn't on this
// machine can connect (e.g. via the mcp-remote bridge). Stateless: this
// server's tools never need to send a request back to the client, so there's
// nothing session state would buy us.
func runHTTP(server *mcp.Server, token string) {
	addr := os.Getenv("MCP_LISTEN_ADDR")
	if addr == "" {
		addr = ":8811"
	}

	handler := mcp.NewStreamableHTTPHandler(
		func(*http.Request) *mcp.Server { return server },
		&mcp.StreamableHTTPOptions{Stateless: true},
	)

	log.Printf("lyftr-mcp: serving MCP over HTTP on %s", addr)
	if err := http.ListenAndServe(addr, requireBearerToken(token, handler)); err != nil {
		log.Fatalf("lyftr-mcp: %v", err)
	}
}

// requireBearerToken rejects any request whose Authorization header doesn't
// present the same personal access token this server uses against the
// backend. This is the only thing standing between the network and the
// user's data once the port is reachable, so a missing/wrong token is a flat
// 401 with no further detail.
func requireBearerToken(token string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		got, ok := strings.CutPrefix(auth, "Bearer ")
		if !ok || got != token {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}
