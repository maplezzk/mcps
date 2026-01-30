# mcps - MCP CLI Manager

[English](./README_EN.md) | [简体中文](./README.md)

A powerful command-line interface for managing and interacting with [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) servers.

## Features

- 🔌 **Server Management**: Easily add, remove, list, and update MCP servers (Stdio & SSE).
- 🛠️ **Tool Discovery**: List available tools from any configured server.
- 🚀 **Tool Execution**: Call tools directly from the CLI with automatic argument parsing.
- 🔄 **Persistence**: Automatically saves configuration to `~/.mcps/mcp.json`.

## Installation

```bash
npm install -g mcps
```

## Usage

### 1. Server Management

**List all servers:**
```bash
mcps server list
```

**Add a Stdio server:**
```bash
# Add a local Node.js server
mcps server add my-server --command node --args ./build/index.js

# Add a server using npx/uvx
mcps server add fetch --command uvx --args mcp-server-fetch
```

**Add an SSE server:**
```bash
mcps server add remote-server --type sse --url http://localhost:8000/sse
```

**Add a Streamable HTTP server:**
```bash
mcps server add my-http-server --type http --url http://localhost:8000/mcp
```

**Remove a server:**
```bash
mcps server remove my-server
```

### 2. Tool Interaction

**List tools available on a server:**
```bash
mcps tools fetch
```

**Call a tool:**

Syntax:
```bash
mcps call <server_name> <tool_name> [arguments...]
```

- `<server_name>`: The name of the configured MCP server
- `<tool_name>`: The name of the tool to call
- `[arguments...]`: Arguments passed as `key=value` pairs. The CLI attempts to parse values as JSON (numbers, booleans, objects) automatically.

Examples:
```bash
# Simple string argument
mcps call fetch fetch url="https://example.com"

# JSON object argument
mcps call my-server createUser user='{"name": "Alice", "age": 30}'

# Boolean/Number argument
mcps call my-server config debug=true timeout=5000
```

## Configuration File

By default, configuration is stored in:
`~/.mcps/mcp.json`

You can override this location by setting the `MCP_CONFIG_DIR` environment variable.

## License

ISC
