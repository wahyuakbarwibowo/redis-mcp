# redis-mcp

A safe, connection-efficient Redis [MCP](https://modelcontextprotocol.io) server.

## Design goals

- **No accidental data loss.** Destructive tools (`redis_delete`, `redis_expire`, `redis_flushdb`) refuse to run unless called with `confirm=true` — the tool description instructs the AI to ask the user first. `redis_flushdb` additionally requires the literal phrase `confirm_phrase="FLUSH ALL DATA"`. `redis_set` refuses to overwrite an existing key unless `overwrite=true`.
- **Gentle on the Redis server.**
  - One lazy, reused connection per MCP process (`lazyConnect`) — no connection churn, no pool needed since stdio MCP calls are sequential.
  - `SCAN` with cursor + result limits instead of `KEYS` (never blocks the server).
  - `UNLINK` instead of `DEL` and `FLUSHDB ASYNC` — deletes happen in a background thread on the Redis side.
  - Collection reads are truncated to 200 elements.

## Tools

| Tool | Description | Destructive? |
|---|---|---|
| `redis_get` | Get a string key | no |
| `redis_scan` | List keys by pattern (SCAN, limited) | no |
| `redis_inspect` | Type + TTL + value for any key type | no |
| `redis_info` | Server INFO (memory, stats, keyspace, …) | no |
| `redis_set` | Set a string key (won't overwrite without `overwrite=true`) | no |
| `redis_delete` | Delete keys via UNLINK | **requires `confirm=true`** |
| `redis_expire` | Set a key's TTL | **requires `confirm=true`** |
| `redis_flushdb` | Wipe the current DB | **requires `confirm=true` + phrase** |

## Requirements

- Node.js ≥ 18
- A reachable Redis server

## Install

```bash
git clone <this-repo> redis-mcp
cd redis-mcp
npm install
```

Configuration is a single env var:

- `REDIS_URL` — default `redis://127.0.0.1:6379`. Examples: `redis://user:pass@host:6379/2`, `rediss://host:6380` (TLS).

Run manually to verify: `REDIS_URL=redis://127.0.0.1:6379 node src/index.js` (it prints `[redis-mcp] ready` on stderr).

In all snippets below, replace `/absolute/path/to/redis-mcp` with where you cloned it.

### Claude Code

```bash
claude mcp add redis --env REDIS_URL=redis://127.0.0.1:6379 -- node /absolute/path/to/redis-mcp/src/index.js
```

Or add to `.mcp.json` in your project (or `~/.claude.json` for global):

```json
{
  "mcpServers": {
    "redis": {
      "command": "node",
      "args": ["/absolute/path/to/redis-mcp/src/index.js"],
      "env": { "REDIS_URL": "redis://127.0.0.1:6379" }
    }
  }
}
```

### Claude Desktop

Add the same `mcpServers` block to `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`).

### Codex (OpenAI Codex CLI)

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.redis]
command = "node"
args = ["/absolute/path/to/redis-mcp/src/index.js"]
env = { REDIS_URL = "redis://127.0.0.1:6379" }
```

### OpenCode

Add to `opencode.json` (project) or `~/.config/opencode/opencode.json` (global):

```json
{
  "mcp": {
    "redis": {
      "type": "local",
      "command": ["node", "/absolute/path/to/redis-mcp/src/index.js"],
      "environment": { "REDIS_URL": "redis://127.0.0.1:6379" },
      "enabled": true
    }
  }
}
```

### Kilo Code

Settings → MCP Servers → Edit MCP Settings (`mcp_settings.json`), or `.kilocode/mcp.json` in your project:

```json
{
  "mcpServers": {
    "redis": {
      "command": "node",
      "args": ["/absolute/path/to/redis-mcp/src/index.js"],
      "env": { "REDIS_URL": "redis://127.0.0.1:6379" }
    }
  }
}
```

### Antigravity (Google)

Agent panel → MCP servers (⚙) → Manage MCP Servers → View raw config (`mcp_config.json`):

```json
{
  "mcpServers": {
    "redis": {
      "command": "node",
      "args": ["/absolute/path/to/redis-mcp/src/index.js"],
      "env": { "REDIS_URL": "redis://127.0.0.1:6379" }
    }
  }
}
```

## Safety model

1. The AI calls a destructive tool without `confirm` → the server **refuses** and returns a message telling the AI to ask the user first, listing exactly what would be deleted.
2. The user explicitly approves.
3. The AI retries with `confirm=true` (and the confirm phrase for flush).

The gate lives in the server, so it holds even if the client/AI forgets to ask.

## License

MIT
