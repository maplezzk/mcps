# mcps - MCP CLI Manager

[English](./README.md) | [简体中文](./README.zh.md)

一个用于管理和交互 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 服务的强大命令行工具。

## 功能特性

- 🔌 **服务管理**：轻松添加、移除、查看和更新 MCP 服务（支持 Stdio、SSE 和 HTTP 模式）
- 🛠️ **工具发现**：查看已配置服务中所有可用的工具
- 🚀 **工具执行**：直接在命令行调用工具，支持参数自动解析
- 🔄 **守护进程**：保持与 MCP 服务的长连接，显著提高性能
- 📊 **表格输出**：清晰的服务器状态和工具列表展示
- 🔍 **工具筛选**：按关键词筛选工具，支持简洁模式
- 🚨 **详细日志**：可选的详细日志模式，方便调试
- ✅ **自动化测试**：完整的测试套件，确保代码质量

## MCP 协议支持

已支持 **MCP 2026-07-28** 与官方 SDK v2，包括新版自动协商和旧版回退、资源、提示词、参数补全、手动多轮 elicitation 与 OAuth 客户端凭据认证。已验证范围及可选能力见 [支持矩阵](docs/MCP_SUPPORT.md)。

```bash
mcps discover my-server
mcps resources my-server
mcps read my-server resource://document
mcps prompts my-server
mcps prompt my-server welcome name=Taipei
mcps call my-server my-tool --output-json
```

## 安装

```bash
npm install -g @maplezzk/mcps
```

## 快速开始

```bash
# 1. 添加一个服务
mcps add fetch --command uvx --args mcp-server-fetch

# 2. 启动守护进程
mcps start

# 3. 查看服务状态
mcps status

# 4. 查看可用工具
mcps tools fetch

# 5. 调用工具
mcps call fetch fetch url="https://example.com"
```

## 使用指南

### 1. 守护进程 (Daemon Mode)

mcps 支持守护进程模式，可以保持与 MCP 服务的长连接，显著提高频繁调用的性能。

**启动守护进程：**
```bash
# 普通模式
mcps start

# 详细模式（显示每个服务器的连接过程和禁用的服务器）
mcps start --verbose
```

输出示例：
```
Starting daemon in background...
[Daemon] Connecting to 7 server(s)...
[Daemon] - chrome-devtools... Connected ✓
[Daemon] - fetch... Connected ✓
[Daemon] - gitlab-mr-creator... Connected ✓
[Daemon] Connected: 7/7
Daemon started successfully on port 4100.
```

**重启连接：**
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

输出示例：
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

### 2. 服务管理 (Server Management)

**查看所有服务（配置信息）：**
```bash
mcps ls
```

输出示例：
```
NAME                TYPE    ENABLED  COMMAND/URL
─────────────────   ──────  ───────  ─────────────
chrome-devtools     stdio   ✓        npx -y chrome-devtools-mcp ...
fetch               stdio   ✓        uvx mcp-server-fetch
my-server           stdio   ✗        npx my-server
Total: 3 server(s)
```

**添加 Stdio 服务：**
```bash
# 添加本地 Node.js 服务
mcps add my-server --command node --args ./build/index.js

# 使用 npx/uvx 添加服务
mcps add fetch --command uvx --args mcp-server-fetch

# 添加带环境变量的服务
mcps add my-db --command npx --args @modelcontextprotocol/server-postgres --env POSTGRES_CONNECTION_STRING="${DATABASE_URL}"
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

# 同时更新命令和参数
mcps update my-server --command node --args ./new-build/index.js
```

### 3. 工具交互 (Tool Interaction)

**查看服务下的可用工具：**
```bash
# 详细模式（显示所有信息，包括嵌套对象属性）
mcps tools chrome-devtools

# 简洁模式（只显示工具名称）
mcps tools chrome-devtools --simple

# JSON 输出（原始工具 schema）
mcps tools chrome-devtools --json

# 筛选工具（按关键词）
mcps tools chrome-devtools --tool screenshot

# 多个关键词 + 简洁模式
mcps tools gitlab-mr-creator --tool file --tool wiki --simple
```

详细模式输出示例（包含嵌套对象）：
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

简洁模式输出示例：
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

**调用工具：**

语法：
```bash
mcps call <server_name> <tool_name> [options] [arguments...]
```

- `<server_name>`: 已配置的 MCP 服务名称
- `<tool_name>`: 要调用的工具名称
- `[options]`: 可选参数（`--raw`, `--json`, `--timeout`）
- `[arguments...]`: 以 `key=value` 形式传递的参数

**选项：**

| 选项 | 说明 |
|------|------|
| `-r, --raw` | 将所有值作为原始字符串处理（禁用 JSON 解析） |
| `-j, --json <value>` | 从 JSON 字符串或文件加载参数 |
| `-t, --timeout <seconds>` | 请求超时时间（秒），默认 300（5分钟） |

**默认模式（自动 JSON 解析）：**

默认情况下，参数值会被自动解析为 JSON：
```bash
# 字符串
mcps call fetch fetch url="https://example.com"

# 数字和布尔值会被解析
mcps call fetch fetch max_length=5000 follow_redirects=true
# 实际发送: { "max_length": 5000, "follow_redirects": true }

# JSON 对象
mcps call my-server createUser user='{"name": "Alice", "age": 30}'

# 混合参数
mcps call my-server config debug=true timeout=5000 options='{"retries": 3}'
```

**--raw 模式（仅字符串值）：**

使用 `--raw` 禁用 JSON 解析，所有值保持为字符串：
```bash
# ID 和编码保持为字符串
mcps call my-db createOrder --raw order_id="12345" sku="ABC-001"
# 实际发送: { "order_id": "12345", "sku": "ABC-001" }

# 带特殊字符的 SQL 查询
mcps call alibaba-dms createDataChangeOrder --raw \
  database_id="36005357" \
  script="DELETE FROM table WHERE id = 'xxx';" \
  logic=true
# 实际发送: { "database_id": "36005357", "script": "...", "logic": "true" }
```

**--timeout 模式（自定义超时）：**

使用 `--timeout` 覆盖默认的 300 秒（5分钟）请求超时，适用于长时间运行的工具：
```bash
# 设 3 分钟超时
mcps call my-server download_label order_id="123" --timeout 180
```

**--json 模式（复杂参数）：**

对于复杂参数，使用 `--json` 从 JSON 字符串或文件加载：
```bash
# JSON 字符串
mcps call my-server createUser --json '{"name": "Alice", "age": 30}'

# 文件
mcps call my-server createUser --json params.json
```

## 配置文件

默认情况下，配置文件存储在：
`~/.mcps/mcp.json`

您可以通过设置 `MCPS_CONFIG_DIR` 环境变量来更改存储位置。

配置文件示例：
```json
{
  "daemonTimeout": 20000,
  "mcpServers": {
    "fetch": {
      "command": "uvx",
      "args": ["mcp-server-fetch"],
      "protocolVersion": "auto"
    },
    "my-server": {
      "command": "node",
      "args": ["./build/index.js"],
      "cwd": "/workspace/my-server",
      "env": { "API_KEY": "${API_KEY}" },
      "disabled": false
    },
    "remote": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer ${MCP_TOKEN}" }
    }
  }
}
```


使用 `mcps config path` 查看实际路径，用 `mcps config validate` 检查配置。写入保留根字段和扩展字段，采用原子替换；配置损坏或条目无效时拒绝覆盖。旧 `servers` 数组格式不受支持，应先转换为以服务名为键的 `mcpServers` 对象。

## 环境变量

- `MCPS_CONFIG_DIR`: 配置文件目录（默认：`~/.mcps`）
- `MCPS_PORT`: Daemon 端口（默认：`4100`）
- `MCPS_VERBOSE`: 详细日志模式（默认：`false`）

## 命令参考

### 服务管理
- `mcps ls` - 列出所有服务
- `mcps add <name>` - 添加新服务
- `mcps rm <name>` - 移除服务
- `mcps update [name]` - 更新服务配置

### 守护进程
- `mcps start [-v]` - 启动守护进程（`-v` 显示详细日志）
- `mcps stop` - 停止守护进程
- `mcps status` - 查看守护进程状态
- `mcps restart [server]` - 重启守护进程或特定服务

### 工具交互
- `mcps tools <server> [-s] [-j] [-t <name>...]` - 查看可用工具
  - `-s, --simple`: 只显示工具名称
  - `-j, --json`: 输出原始 JSON（用于调试）
  - `-t, --tool`: 按名称筛选工具（可重复使用）
- `mcps call <server> <tool> [args...]` - 调用工具

## 性能优化

mcps 通过以下方式优化性能：

1. **守护进程模式**：保持长连接，避免重复启动开销
2. **工具缓存**：连接时缓存工具数量，避免重复查询
3. **异步连接**：并行初始化多个服务器连接

典型性能：
- 启动守护进程：10-15 秒（首次，取决于服务数量）
- 查看状态：~200ms
- 调用工具：~50-100ms


## 开发工作流

欢迎贡献代码！

**快速开始：**
```bash
# 克隆项目
git clone https://github.com/maplezzk/mcps.git
cd mcps
npm install

# 开发模式
npm run dev -- <command>

# 构建和测试
npm run build
npm test
```

**重要规范：**
- 不要直接在 `main` 分支提交代码
- 使用 `npm version` 更新版本号（禁止手动修改）
- 新功能必须包含单元测试

📖 **完整开发文档**：[DEVELOPMENT.md](./DEVELOPMENT.md)


## 常见问题

**Q: 如何查看所有服务器的运行状态？**
```bash
mcps status  # 查看活跃连接
mcps ls      # 查看所有配置（包括禁用的）
```

**Q: 某个服务连接失败了怎么办？**
```bash
# 查看详细日志
mcps start --verbose

# 重启该服务
mcps restart my-server
```

**Q: 如何临时禁用某个服务？**
在配置文件中设置 `"disabled": true`，或使用 `mcps update` 修改配置。

**Q: 工具太多怎么快速找到？**
```bash
# 筛选工具名称
mcps tools my-server --tool keyword

# 只显示名称
mcps tools my-server --simple
```

## 许可证

ISC
