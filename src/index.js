#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import Redis from "ioredis";

// ponytail: one lazy, reused connection — no pool needed for a stdio MCP
// (single client, sequential tool calls). ioredis auto-reconnects.
const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
  lazyConnect: true,          // connect on first command, not at startup
  connectTimeout: 5000,
  maxRetriesPerRequest: 2,
  enableOfflineQueue: true,
  connectionName: "redis-mcp",
});
redis.on("error", (e) => console.error("[redis-mcp]", e.message));

const server = new McpServer({ name: "redis-mcp", version: "1.0.0" });

const ok = (data) => ({
  content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
});
const err = (msg) => ({ content: [{ type: "text", text: `ERROR: ${msg}` }], isError: true });

const CONFIRM_MSG =
  "REFUSED: destructive operation. Ask the user for explicit confirmation first, " +
  "then retry with confirm=true.";

// ---------- read-only tools ----------

server.tool(
  "redis_get",
  "Get the value of a key (string). For hashes/lists/sets/zsets use redis_inspect.",
  { key: z.string() },
  async ({ key }) => {
    const v = await redis.get(key);
    return ok(v === null ? "(nil)" : v);
  }
);

server.tool(
  "redis_scan",
  "List keys matching a pattern using SCAN (cursor-based, non-blocking — never uses KEYS). Returns up to `limit` keys.",
  {
    pattern: z.string().default("*"),
    limit: z.number().int().min(1).max(1000).default(100),
  },
  async ({ pattern, limit }) => {
    const keys = [];
    let cursor = "0";
    do {
      const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== "0" && keys.length < limit);
    return ok({ count: Math.min(keys.length, limit), keys: keys.slice(0, limit), truncated: keys.length > limit || undefined });
  }
);

server.tool(
  "redis_inspect",
  "Inspect a key: type, TTL, and its value regardless of type (hash/list/set/zset/string). Large collections are truncated to 200 elements.",
  { key: z.string() },
  async ({ key }) => {
    const type = await redis.type(key);
    if (type === "none") return ok("(key does not exist)");
    const ttl = await redis.ttl(key);
    let value;
    switch (type) {
      case "string": value = await redis.get(key); break;
      case "hash":   value = await redis.hgetall(key); break;
      case "list":   value = await redis.lrange(key, 0, 199); break;
      case "set":    value = (await redis.sscan(key, 0, "COUNT", 200))[1]; break;
      case "zset":   value = await redis.zrange(key, 0, 199, "WITHSCORES"); break;
      default:       value = `(unsupported type: ${type})`;
    }
    return ok({ key, type, ttl, value });
  }
);

server.tool(
  "redis_info",
  "Redis server info (INFO sections: server, clients, memory, stats, keyspace).",
  { section: z.enum(["server", "clients", "memory", "stats", "keyspace", "replication", "all"]).default("all") },
  async ({ section }) => ok(section === "all" ? await redis.info() : await redis.info(section))
);

// ---------- write (non-destructive) ----------

server.tool(
  "redis_set",
  "Set a string key. Optional TTL in seconds. Refuses to overwrite an existing key unless overwrite=true.",
  {
    key: z.string(),
    value: z.string(),
    ttl_seconds: z.number().int().positive().optional(),
    overwrite: z.boolean().default(false),
  },
  async ({ key, value, ttl_seconds, overwrite }) => {
    // SET NX is atomic — no exists+set race
    const args = [...(ttl_seconds ? ["EX", ttl_seconds] : []), ...(overwrite ? [] : ["NX"])];
    const r = await redis.set(key, value, ...args);
    if (r === null) return err(`key "${key}" already exists — pass overwrite=true to replace it`);
    return ok(`OK: set "${key}"${ttl_seconds ? ` (TTL ${ttl_seconds}s)` : ""}`);
  }
);

// ---------- destructive (confirm-gated) ----------

server.tool(
  "redis_delete",
  "DELETE keys. DESTRUCTIVE — requires confirm=true, which you must only set after the user explicitly approves the exact keys listed.",
  {
    keys: z.array(z.string()).min(1).max(100),
    confirm: z.boolean().default(false),
  },
  async ({ keys, confirm }) => {
    if (!confirm) return err(`${CONFIRM_MSG} Keys that would be deleted: ${keys.join(", ")}`);
    const n = await redis.unlink(...keys); // UNLINK: non-blocking delete
    return ok(`Deleted ${n} of ${keys.length} key(s) (rest did not exist).`);
  }
);

server.tool(
  "redis_expire",
  "Set/replace a key's TTL (key auto-deletes when it expires). DESTRUCTIVE — requires confirm=true after user approval.",
  { key: z.string(), ttl_seconds: z.number().int().positive(), confirm: z.boolean().default(false) },
  async ({ key, ttl_seconds, confirm }) => {
    if (!confirm) return err(`${CONFIRM_MSG} Would set "${key}" to expire in ${ttl_seconds}s.`);
    const r = await redis.expire(key, ttl_seconds);
    return r ? ok(`OK: "${key}" expires in ${ttl_seconds}s`) : err(`key "${key}" does not exist`);
  }
);

server.tool(
  "redis_flushdb",
  "FLUSH the ENTIRE current database (like truncate). EXTREMELY DESTRUCTIVE — requires confirm=true AND confirm_phrase='FLUSH ALL DATA', both only after explicit user approval.",
  { confirm: z.boolean().default(false), confirm_phrase: z.string().default("") },
  async ({ confirm, confirm_phrase }) => {
    if (!confirm || confirm_phrase !== "FLUSH ALL DATA")
      return err(`${CONFIRM_MSG} This wipes EVERY key in the current DB. Also requires confirm_phrase="FLUSH ALL DATA".`);
    const size = await redis.dbsize();
    await redis.flushdb("ASYNC"); // non-blocking flush
    return ok(`Flushed database (${size} keys removed).`);
  }
);

// ---------- start ----------

const transport = new StdioServerTransport();
await server.connect(transport);
// exit when the client disconnects — otherwise the open redis socket keeps the process alive
const shutdown = () => { redis.disconnect(); process.exit(0); };
server.server.onclose = shutdown;
process.stdin.on("end", shutdown);
process.stdin.on("close", shutdown);
console.error("[redis-mcp] ready —", process.env.REDIS_URL || "redis://127.0.0.1:6379");

process.on("SIGINT", () => { redis.disconnect(); process.exit(0); });
process.on("SIGTERM", () => { redis.disconnect(); process.exit(0); });
