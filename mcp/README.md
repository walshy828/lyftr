# lyftr-mcp

An [MCP](https://modelcontextprotocol.io) server that lets an MCP client
(Claude Desktop, Claude Code) read and write your Lyftr data — workouts,
weight, food, exercises, and programs — through the same REST API the web app
uses, authenticating with a personal access token instead of an interactive
login.

It supports two transports, selected by `MCP_TRANSPORT`:

- **stdio** (default) — the client launches `lyftr-mcp` as a local subprocess.
  Simplest, but the binary has to live on the same machine as the client, since
  stdio is a local pipe.
- **http** — `lyftr-mcp` runs as a long-lived network service (e.g. in Docker
  next to your backend) that a client on another machine connects to over your
  network via a small local bridge. Use this if your MCP client (e.g. Claude
  Desktop on a laptop) isn't on the same machine as your self-hosted instance.

## 1. Create a personal access token

In the Lyftr web app: **Settings → Personal access tokens → New token**. Copy
the value shown — it's only displayed once.

## 2. Pick a setup

### Option A — stdio, same machine

Build the binary on the machine that runs your MCP client:

```bash
cd mcp
go build -o lyftr-mcp .
```

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

Or with Claude Code:

```bash
claude mcp add lyftr --env LYFTR_API_URL=http://localhost:3000/api/v1 --env LYFTR_TOKEN=lyftr_pat_... -- /absolute/path/to/lyftr-mcp
```

(Check `claude mcp add --help` for the current flag syntax if this doesn't match your installed version.)

### Option B — http, MCP server runs on your Docker host, client is elsewhere

This is the setup for e.g. Lyftr self-hosted on a home server, MCP client on a
laptop on the same network. No binary to build or copy onto the client
machine — the compose file already builds and runs `lyftr-mcp` for you.

1. On the Docker host, uncomment/set in `.env` (see `.env.example`):
   ```
   LYFTR_MCP_TOKEN=lyftr_pat_...   # the token from step 1
   MCP_PORT=8811                    # optional, defaults to 8811
   ```
2. `docker compose up -d mcp` — this builds and starts the `mcp` service from
   `docker-compose.yml`, publishing `MCP_PORT` on the host so other machines
   on your network can reach it (`http://<docker-host>:8811`).
3. On the client machine, no Go build required — Claude Desktop still only
   speaks stdio, so bridge it to the remote HTTP endpoint with
   [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) via `npx` (needs
   Node.js installed, nothing else):

   ```json
   {
     "mcpServers": {
       "lyftr": {
         "command": "npx",
         "args": [
           "-y", "mcp-remote",
           "http://<docker-host>:8811",
           "--header", "Authorization: Bearer lyftr_pat_...",
           "--transport", "http-only",
           "--allow-http"
         ]
       }
     }
   }
   ```

   Claude Desktop launches `npx mcp-remote` locally (that's the only local
   process), and it proxies stdio ↔ your remote `lyftr-mcp` over HTTP,
   carrying the token as a bearer header on every request. Replace
   `<docker-host>` with however you reach that machine on your LAN (hostname
   or IP) and use the same token value from step 1.

   `--allow-http` is required: `mcp-remote` refuses plain HTTP to anything
   other than `localhost` by default (it doesn't want to send your bearer
   token unencrypted without you opting in). That's a reasonable default to
   override on a trusted home LAN, but it does mean the token and your Lyftr
   data cross the network unencrypted — put a reverse proxy with TLS in front
   of this port instead if that matters to you.

   For Claude Code, the equivalent is:
   ```bash
   claude mcp add lyftr -- npx -y mcp-remote http://<docker-host>:8811 --header "Authorization: Bearer lyftr_pat_..." --transport http-only --allow-http
   ```

The `mcp` HTTP endpoint rejects any request whose `Authorization` header
doesn't exactly match `LYFTR_MCP_TOKEN` — that's the only thing standing
between your LAN and your data once the port is published, so treat that
token like a password and only publish the port on a network you trust.

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
