# mcps - MCP CLI Manager

[English](./README.md) | [简体中文](./README.zh.md)

A powerful command-line interface for managing and interacting with [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) servers.

## Features

- 🔌 **Server Management**: Easily add, remove, list, and update MCP servers (Stdio, SSE, and HTTP modes)
- 🛠️ **Tool Discovery**: List available tools from any configured server
- 🚀 **Tool Execution**: Call tools directly from the CLI with automatic argument parsing
- 🔄 **Daemon Mode**: Maintain persistent connections to MCP servers for better performance
- 📊 **Table Output**: Clear server status and tool listings
- 🔍 **Tool Filtering**: Filter tools by keywords with simple mode
- 🚨 **Verbose Logging**: Optional detailed logging for debugging

## Installation

```bash
npm install -g @maplezzk/mcps
```

## Quick Start

```bash
# 1. Add a server
mcps add fetch --command uvx --args mcp-server-fetch

# 2. Start the daemon
mcps start

# 3. Check server status
mcps status

# 4. List available tools
mcps tools fetch

# 5. Call a tool
mcps call fetch fetch url="https://example.com"
```

## Usage Guide

### 1. Daemon Mode

mcps supports a daemon mode that maintains persistent connections to MCP servers, significantly improving performance for frequent calls.

**Start Daemon:**
```bash
# Normal mode
mcps start

# Verbose mode (show connection process for each server and disabled servers)
mcps start --verbose
```

Output example:
```
Starting daemon in background...
[Daemon] Connecting to 7 server(s)...
[Daemon] - chrome-devtools... Connected ✓
[Daemon] - fetch... Connected ✓
[Daemon] - gitlab-mr-creator... Connected ✓
[Daemon] Connected: 7/7
Daemon started successfully on port 4100.
```

**Restart Connections:**
```bash
# Reset all connections
mcps restart

# Reset connection for a specific server
mcps restart my-server
```

**Stop Daemon:**
```bash
mcps stop
```

**Check Daemon Status:**
```bash
mcps status
```

Output example:
```
Daemon is running (v1.0.29)

Active Connections:
NAME                STATUS      TOOLS
─────────────────   ──────────  ──────
chrome-devtools     Connected   26
fetch               Connected   1
gitlab-mr-creator   Connected   30
Total: 3 connection(s)
```

### 2. Server Management

**List all servers (configuration):**
```bash
mcps ls
```

Output example:
```
NAME                TYPE    ENABLED  COMMAND/URL
─────────────────   ──────  ───────  ─────────────
chrome-devtools     stdio   ✓        npx -y chrome-devtools-mcp ...
fetch               stdio   ✓        uvx mcp-server-fetch
my-server           stdio   ✗        npx my-server
Total: 3 server(s)
```

**Add Stdio Server:**
```bash
# Add local Node.js server
mcps add my-server --command node --args ./build/index.js

# Use npx/uvx to add server
mcps add fetch --command uvx --args mcp-server-fetch

# Add server with environment variables
mcps add my-db --command npx --args @modelcontextprotocol/server-postgres --env POSTGRES_CONNECTION_STRING="${DATABASE_URL}"
```

**Add SSE Server:**
```bash
mcps add remote-server --type sse --url http://localhost:8000/sse
```

**Add Streamable HTTP Server:**
```bash
mcps add my-http-server --type http --url http://localhost:8000/mcp
```

**Remove Server:**
```bash
mcps rm my-server
```

**Update Server:**
```bash
# Refresh all server connections
mcps update

# Update specific server command
mcps update my-server --command new-command

# Update specific server arguments
mcps update my-server --args arg1 arg2

# Update both command and arguments
mcps update my-server --command node --args ./new-build/index.js
```

### 3. Tool Interaction

**List available tools on a server:**
```bash
# Detailed mode (show all information including nested object properties)
mcps tools chrome-devtools

# Simple mode (show only tool names)
mcps tools chrome-devtools --simple

# JSON output (raw tool schema)
mcps tools chrome-devtools --json

# Filter tools by keyword
mcps tools chrome-devtools --tool screenshot

# Multiple keywords + simple mode
mcps tools gitlab-mr-creator --tool file --tool wiki --simple
```

Detailed mode output example (with nested objects):
```
Available Tools for chrome-devtools:

- take_screenshot
  Take a screenshot of the page or element.
  Arguments:
    format*: string ["jpeg", "png", "webp"] (Type of format to save the screenshot as...)
    quality: number (Compression quality from 0-100)
    uid: string (The uid of an element to screenshot...)

- click
  Clicks on the provided element
  Arguments:
    uid*: string (The uid of an element...)
```

Simple mode output example:
```
$ mcps tools chrome-devtools -s
click
close_page
drag
emulate
evaluate_script
fill
...
take_screenshot
take_snapshot

Total: 26 tool(s)
```

**Call Tools:**

Syntax:
```bash
mcps call <server_name> <tool_name> [options] [arguments...]
```

- `<server_name>`: Name of the configured MCP server
- `<tool_name>`: Name of the tool to call
- `[options]`: Optional flags (`--raw`, `--json`)
- `[arguments...]`: Arguments passed as `key=value` pairs

**Options:**

| Option | Description |
|--------|-------------|
| `-r, --raw` | Treat all values as raw strings (disable JSON parsing) |
| `-j, --json <value>` | Load parameters from JSON string or file |

**Default Mode (Auto JSON Parsing):**

By default, values are automatically parsed as JSON:
```bash
# String
mcps call fetch fetch url="https://example.com"

# Numbers and booleans are parsed
mcps call fetch fetch max_length=5000 follow_redirects=true
# Sends: { "max_length": 5000, "follow_redirects": true }

# JSON object
mcps call my-server createUser user='{"name": "Alice", "age": 30}'

# Mixed
mcps call my-server config debug=true timeout=5000 options='{"retries": 3}'
```

**--raw Mode (String Values Only):**

Use `--raw` to disable JSON parsing. All values remain as strings:
```bash
# IDs and codes stay as strings
mcps call my-db createOrder --raw order_id="12345" sku="ABC-001"
# Sends: { "order_id": "12345", "sku": "ABC-001" }

# SQL queries with special characters
mcps call alibaba-dms createDataChangeOrder --raw \
  database_id="36005357" \
  script="DELETE FROM table WHERE id = 'xxx';" \
  logic=true
# Sends: { "database_id": "36005357", "script": "...", "logic": "true" }
```

**--json Mode (Complex Parameters):**

For complex parameters, use `--json` to load from a JSON string or file:
```bash
# From JSON string
mcps call my-server createUser --json '{"name": "Alice", "age": 30}'

# From file
mcps call my-server createUser --json params.json
```

## Configuration File

By default, the configuration file is stored at:
`~/.mcps/mcp.json`

You can change the storage location by setting the `MCPS_CONFIG_DIR` environment variable.

Configuration file example:
```json
{
  "servers": [
    {
      "name": "fetch",
      "type": "stdio",
      "command": "uvx",
      "args": ["mcp-server-fetch"]
    },
    {
      "name": "my-server",
      "type": "stdio",
      "command": "node",
      "args": ["./build/index.js"],
      "env": {
        "API_KEY": "${API_KEY}"
      },
      "disabled": false
    }
  ]
}
```

## Environment Variables

- `MCPS_CONFIG_DIR`: Configuration file directory (default: `~/.mcps`)
- `MCPS_PORT`: Daemon port (default: `4100`)
- `MCPS_VERBOSE`: Verbose logging mode (default: `false`)

## Command Reference

### Server Management
- `mcps ls` - List all servers
- `mcps add <name>` - Add a new server
- `mcps rm <name>` - Remove a server
- `mcps update [name]` - Update server configuration

### Daemon
- `mcps start [-v]` - Start daemon (`-v` for detailed logging)
- `mcps stop` - Stop daemon
- `mcps status` - Check daemon status
- `mcps restart [server]` - Restart daemon or specific server

### Tool Interaction
- `mcps tools <server> [-s] [-j] [-t <name>...]` - List available tools
  - `-s, --simple`: Show only tool names
  - `-j, --json`: Output raw JSON (for debugging)
  - `-t, --tool`: Filter tools by name (can be used multiple times)
- `mcps call <server> <tool> [args...]` - Call a tool

## Performance

mcps optimizes performance through:

1. **Daemon Mode**: Maintains persistent connections, avoiding repeated startup overhead
2. **Tool Caching**: Caches tool counts during connection, avoiding repeated queries
3. **Async Connections**: Parallel initialization of multiple server connections

Typical performance:
- Start daemon: 10-15 seconds (first time, depends on server count)
- Check status: ~200ms
- Call tool: ~50-100ms

## FAQ

**Q: How to check the status of all servers?**
```bash
mcps status  # Check active connections
mcps ls      # Check all configurations (including disabled)
```

**Q: What if a server fails to connect?**
```bash
# View detailed logs
mcps start --verbose

# Restart that server
mcps restart my-server
```

**Q: How to temporarily disable a server?**
Set `"disabled": true` in the configuration file, or use `mcps update` to modify the configuration.

**Q: How to quickly find tools when there are many?**
```bash
# Filter tools by keyword
mcps tools my-server --tool keyword

# Show only names
mcps tools my-server --simple
```

## License

ISC
