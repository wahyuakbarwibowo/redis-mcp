# redis-mcp

Safe, connection-efficient [Model Context Protocol](https://modelcontextprotocol.io) server for Redis.

It exposes common Redis inspection and write operations while requiring explicit confirmation for destructive actions.

## Features

- Reuses one lazy Redis connection per MCP process.
- Uses cursor-based `SCAN` instead of blocking `KEYS`.
- Uses `UNLINK` and `FLUSHDB ASYNC` for non-blocking deletion.
- Limits collection reads to 200 elements.
- Prevents accidental overwrites unless `overwrite=true` is set.
- Gates destructive tools behind explicit confirmation.

## Tools

| Tool | Purpose | Confirmation |
| --- | --- | --- |
| `redis_get` | Read a string value | — |
| `redis_scan` | Find keys by pattern | — |
| `redis_inspect` | Read type, TTL, and value | — |
| `redis_info` | Read Redis server info | — |
| `redis_set` | Set a string value, optionally with TTL | `overwrite=true` to replace an existing key |
| `redis_delete` | Delete keys with `UNLINK` | `confirm=true` |
| `redis_expire` | Set a key TTL | `confirm=true` |
| `redis_flushdb` | Delete every key in the current database | `confirm=true` and `confirm_phrase="FLUSH ALL DATA"` |

## Requirements

- Node.js 18 or newer
- A reachable Redis server

## Install

```bash
git clone https://github.com/wahyuakbarwibowo/redis-mcp.git
cd redis-mcp
npm install
```

Set `REDIS_URL` to configure Redis. It defaults to `redis://127.0.0.1:6379`.

```bash
REDIS_URL=redis://127.0.0.1:6379 node src/index.js
```

The server communicates over stdio. It logs readiness to stderr.

## MCP configuration

Replace `/absolute/path/to/redis-mcp` with the path where you cloned the repository.

### Claude Code

```bash
claude mcp add redis \
  --env REDIS_URL=redis://127.0.0.1:6379 \
  -- node /absolute/path/to/redis-mcp/src/index.js
```

### Claude Desktop, Codex CLI, OpenCode, Kilo Code, and Antigravity

Use this server command in the client’s MCP configuration:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/redis-mcp/src/index.js"],
  "env": { "REDIS_URL": "redis://127.0.0.1:6379" }
}
```

Each client uses a different wrapper key around this command. See its MCP configuration documentation for the expected format.

## Safety model

Destructive tools follow this sequence:

1. The first call without confirmation is refused and describes the intended action.
2. The user explicitly approves that exact action.
3. The client retries with the required confirmation fields.

The checks run inside the server, so they remain effective even if an MCP client or AI agent forgets to ask first.

## License

MIT
