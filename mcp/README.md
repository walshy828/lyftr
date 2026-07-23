# lyftr-mcp

A local [MCP](https://modelcontextprotocol.io) server that lets an MCP client
(Claude Desktop, Claude Code) read and write your Lyftr data — workouts,
weight, food, exercises, and programs — through the same REST API the web app
uses, authenticating with a personal access token instead of an interactive
login.

It's a stdio server: the client launches it as a local subprocess and talks
to it over stdin/stdout. It never listens on a network port itself.

## 1. Create a personal access token

In the Lyftr web app: **Settings → Personal access tokens → New token**. Copy
the value shown — it's only displayed once.

## 2. Build

```bash
cd mcp
go build -o lyftr-mcp .
```

## 3. Configure your MCP client

Both `LYFTR_API_URL` and `LYFTR_TOKEN` are required.

- `LYFTR_API_URL` — your backend's API base, e.g. `http://localhost:3000/api/v1`
  for a local dev backend, or `https://your-host/api/v1` for a self-hosted
  deployment behind nginx.
- `LYFTR_TOKEN` — the token value from step 1.

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "lyftr": {
      "command": "/absolute/path/to/lyftr-mcp",
      "env": {
        "LYFTR_API_URL": "http://localhost:3000/api/v1",
        "LYFTR_TOKEN": "lyftr_pat_..."
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add lyftr --env LYFTR_API_URL=http://localhost:3000/api/v1 --env LYFTR_TOKEN=lyftr_pat_... -- /absolute/path/to/lyftr-mcp
```

(Check `claude mcp add --help` for the current flag syntax if this doesn't match your installed version.)

## What it can do

Read: profile/settings, workouts, weight logs + stats, food logs + stats/history/search,
saved foods, the exercise library + personal history/PRs, programs.

Write: log workouts, log weight, log food (including parsing a free-text meal
description into macros via `parse_meal`), create/update programs.

It does not expose destructive deletes, admin endpoints, image-upload
endpoints, program sharing, or token management itself — a token can never be
used to mint or revoke other tokens.

## Revoking access

Revoke the token from **Settings → Personal access tokens** at any time —
the MCP server has no other credential and immediately loses access.
