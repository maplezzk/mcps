# mcpp - MCP CLI Manager

[English](./README_EN.md) | [简体中文](./README.md)

一个用于管理和交互 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 服务的强大命令行工具。

## 功能特性

- 🔌 **服务管理**：轻松添加、移除、查看和更新 MCP 服务（支持 Stdio 和 SSE 模式）。
- 🛠️ **工具发现**：查看已配置服务中所有可用的工具。
- 🚀 **工具执行**：直接在命令行调用工具，支持参数自动解析。
- ⚙️ **配置管理**：从现有的 JSON 配置文件（如 `.mcporter`）一键导入配置。
- 🔄 **持久化存储**：配置自动保存至 `~/.mcp/config.json`。

## 安装

```bash
npm install -g mcpp
```

## 使用指南

### 1. 服务管理 (Server Management)

**查看所有服务：**
```bash
mcpp server list
```

**添加 Stdio 服务：**
```bash
# 添加本地 Node.js 服务
mcpp server add my-server --command node --args ./build/index.js

# 使用 npx/uvx 添加服务
mcpp server add fetch --command uvx --args mcp-server-fetch
```

**添加 SSE 服务：**
```bash
mcpp server add remote-server --type sse --url http://localhost:8000/sse
```

**移除服务：**
```bash
mcpp server remove my-server
```

### 2. 工具交互 (Tool Interaction)

**查看服务下的可用工具：**
```bash
mcpp tools fetch
```

**调用工具：**
参数以 `key=value` 形式传递。CLI 会尝试自动将值解析为 JSON（数字、布尔值、对象）。

```bash
# 简单的字符串参数
mcpp call fetch fetch url="https://example.com"

# JSON 对象参数
mcpp call my-server createUser user='{"name": "Alice", "age": 30}'

# 布尔值/数字参数
mcpp call my-server config debug=true timeout=5000
```

## 配置文件

默认情况下，配置文件存储在：
`~/.mcp/config.json`

您可以通过设置 `MCP_CONFIG_DIR` 环境变量来更改存储位置。

## 许可证

ISC
