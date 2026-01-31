# mcps - MCP CLI Manager

[English](./README_EN.md) | [简体中文](./README.md)

一个用于管理和交互 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 服务的强大命令行工具。

## 功能特性

- 🔌 **服务管理**：轻松添加、移除、查看和更新 MCP 服务（支持 Stdio 和 SSE 模式）。
- 🛠️ **工具发现**：查看已配置服务中所有可用的工具。
- 🚀 **工具执行**：直接在命令行调用工具，支持参数自动解析。
- 🔄 **持久化存储**：配置自动保存至 `~/.mcps/mcp.json`。

## 安装

```bash
npm install -g @maplezzk/mcps
```

## 使用指南

### 1. 守护进程 (Daemon Mode)

mcps 支持守护进程模式，可以保持与 MCP 服务的长连接，显著提高频繁调用的性能。

**启动守护进程：**
```bash
mcps start
```

**重启连接：**
如果修改了配置文件，或者服务出现异常，可以使用重启命令刷新连接：

```bash
# 重置所有连接
mcps restart

# 仅重置特定服务的连接
mcps restart my-server
```

**停止守护进程：**
```bash
mcps stop
```

**查看守护进程状态：**
```bash
mcps status
```

> **注意**：旧的三词命令（如 `mcps daemon start`）仍然可用，保持向后兼容。

### 2. 服务管理 (Server Management)

**查看所有服务：**
```bash
mcps ls
```

**添加 Stdio 服务：**
```bash
# 添加本地 Node.js 服务
mcps add my-server --command node --args ./build/index.js

# 使用 npx/uvx 添加服务
mcps add fetch --command uvx --args mcp-server-fetch
```

**添加 SSE 服务：**
```bash
mcps add remote-server --type sse --url http://localhost:8000/sse
```

**添加 Streamable HTTP 服务：**
```bash
mcps add my-http-server --type http --url http://localhost:8000/mcp
```

**移除服务：**
```bash
mcps rm my-server
```

**更新服务：**
```bash
# 刷新所有服务连接
mcps update

# 更新特定服务的命令
mcps update my-server --command new-command

# 更新特定服务的参数
mcps update my-server --args arg1 arg2
```

### 3. 工具交互 (Tool Interaction)

**查看服务下的可用工具：**
```bash
mcps tools fetch
```

**调用工具：**

语法：
```bash
mcps call <server_name> <tool_name> [arguments...]
```

- `<server_name>`: 已配置的 MCP 服务名称
- `<tool_name>`: 要调用的工具名称
- `[arguments...]`: 以 `key=value` 形式传递的参数。CLI 会尝试自动将值解析为 JSON（数字、布尔值、对象）。

示例：
```bash
# 简单的字符串参数
mcps call fetch fetch url="https://example.com"

# JSON 对象参数
mcps call my-server createUser user='{"name": "Alice", "age": 30}'

# 布尔值/数字参数
mcps call my-server config debug=true timeout=5000
```

## 配置文件

默认情况下，配置文件存储在：
`~/.mcps/mcp.json`

您可以通过设置 `MCP_CONFIG_DIR` 环境变量来更改存储位置。

## 许可证

ISC
