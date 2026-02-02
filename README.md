# mcps - MCP CLI Manager

[English](./README_EN.md) | [简体中文](./README.md)

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
# 详细模式（显示所有信息）
mcps tools chrome-devtools

# 简洁模式（只显示工具名称）
mcps tools chrome-devtools --simple

# 筛选工具（按关键词）
mcps tools chrome-devtools --tool screenshot

# 多个关键词 + 简洁模式
mcps tools gitlab-mr-creator --tool file --tool wiki --simple
```

详细模式输出示例：
```
Available Tools for chrome-devtools:

- take_screenshot
  Take a screenshot of the page or element.
  Arguments:
    format*: string (Type of format to save the screenshot as...)
    quality: number (Compression quality from 0-100)
    uid: string (The uid of an element to screenshot...)
    ...

- click
  Clicks on the provided element
  Arguments:
    uid*: string (The uid of an element...)
    ...
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
mcps call <server_name> <tool_name> [arguments...]
```

- `<server_name>`: 已配置的 MCP 服务名称
- `<tool_name>`: 要调用的工具名称
- `[arguments...]`: 以 `key=value` 形式传递的参数。CLI 会尝试自动将值解析为 JSON（数字、布尔值、对象）。

示例：
```bash
# 简单的字符串参数
mcps call fetch fetch url="https://example.com"

# 带多个参数
mcps call fetch fetch url="https://example.com" max_length=5000

# JSON 对象参数
mcps call my-server createUser user='{"name": "Alice", "age": 30}'

# 布尔值/数字参数
mcps call chrome-devtools take_screenshot fullPage=true quality=90

# 混合参数
mcps call my-server config debug=true timeout=5000 options='{"retries": 3}'
```

## 配置文件

默认情况下，配置文件存储在：
`~/.mcps/mcp.json`

您可以通过设置 `MCPS_CONFIG_DIR` 环境变量来更改存储位置。

配置文件示例：
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
- `mcps tools <server> [-s] [-t <name>...]` - 查看可用工具
  - `-s, --simple`: 只显示工具名称
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

欢迎贡献代码！以下是参与项目开发的完整流程。

### 环境准备

**前置要求：**
- Node.js >= 20
- npm >= 9
- Git

**克隆项目：**
```bash
git clone https://github.com/a13835614623/mcps.git
cd mcps
```

**安装依赖：**
```bash
npm install
```

### 本地开发

**开发模式（使用 ts-node 直接运行）：**
```bash
npm run dev -- <command>
# 例如
npm run dev -- ls
npm run dev -- start
```

**构建项目：**
```bash
npm run build
```

**运行构建后的版本：**
```bash
npm start -- <command>
# 或者
node dist/index.js <command>
```

### 测试

**运行测试：**
```bash
# 运行所有测试
npm test

# 监听模式（开发时推荐）
npm run test:watch

# 启动测试 UI 界面
npm run test:ui

# 生成测试覆盖率报告
npm run test:coverage
```

**测试要求：**
- 所有测试必须通过
- 新功能需要添加相应的测试
- 保持测试覆盖率在合理水平

### 提交规范

**提交信息格式：**
```
<type>: <description>

[optional body]

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

**提交类型（type）：**
- `feat`: 新功能
- `fix`: 修复 bug
- `chore`: 构建过程或辅助工具的变动
- `docs`: 文档更新
- `refactor`: 重构（既不是新增功能，也不是修复 bug）
- `style`: 代码格式调整（不影响代码运行的变动）
- `test`: 增加测试
- `perf`: 性能优化

**示例：**
```bash
feat: 支持可配置的 daemon 启动超时时间

新增功能：
- 支持通过命令行参数 --timeout/-t 设置超时
- 支持通过环境变量 MCPS_DAEMON_TIMEOUT 设置超时
- 支持通过配置文件 daemonTimeout 字段设置超时

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

### PR 流程

**⚠️ 重要规范：**
- **永远不要直接在 `main` 分支上提交代码**
- **版本号必须使用 `npm version` 命令更新，禁止手动修改 `package.json`**

**1. 创建功能分支（必须）：**
```bash
# 从 main 分支创建新分支
git checkout main
git pull origin main
git checkout -b feature/your-feature-name

# 或 bug 修复分支
git checkout -b fix/your-bug-fix
```

**分支命名规范：**
- `feature/` - 新功能
- `fix/` - bug 修复
- `refactor/` - 重构
- `docs/` - 文档更新
- `chore/` - 构建/工具更新

**2. 开发并提交：**
```bash
# 进行开发...
npm run build  # 确保构建成功
npm test       # 确保测试通过

# 提交代码（在功能分支上提交）
git add .
git commit -m "feat: 你的功能描述"

# ⚠️ 不要在 main 分支提交！如果误提交到 main，需要重置：
# git checkout main
# git reset --hard HEAD~1  # 回退到上一个提交
# git checkout -b feature/your-feature-name
# git cherry-pick <commit-hash>  # 将提交移到新分支
```

**3. 更新版本号（如需要）：**
```bash
# ⚠️ 必须使用 npm version 命令，禁止手动修改 package.json

# Patch 版本（bug 修复）
npm version patch

# Minor 版本（新功能）
npm version minor

# Major 版本（破坏性变更）
npm version major

# 预发布版本（可选）
npm version prerelease --preid beta
```

**4. 推送并创建 PR：**
```bash
# 推送分支和标签（如果有版本更新）
git push origin feature/your-feature-name
git push origin v1.x.x  # 如果有版本标签
```

然后访问 GitHub 创建 Pull Request，或在命令行使用：
```bash
gh pr create --title "feat: 功能标题" --body "PR 描述"
```

**5. PR 检查清单（创建 PR 前必须检查）：**
- ✅ 从最新 `main` 分支创建的功能分支
- ✅ 代码已提交到功能分支（非 main 分支）
- ✅ **新功能包含对应的单元测试**
- ✅ **版本号已使用 `npm version` 更新（如需要发布）**
- ✅ `npm run build` 构建成功
- ✅ `npm test` 所有测试通过
- ✅ 提交信息符合规范
- ✅ PR 描述清晰说明了变更内容

**⚠️ 常见错误（真实案例）：**

| 错误 | 后果 | 正确做法 |
|------|------|----------|
| 直接在 `main` 分支开发 | 污染主分支，无法创建干净的 PR | 始终创建 `feature/` 或 `fix/` 分支 |
| PR 创建后才更新版本号 | 版本提交不在 PR 中，合并后版本不一致 | **提 PR 前**执行 `npm version` |
| PR 合并后继续往旧分支提交 | 提交无法进入新的 PR，需要 cherry-pick | PR 合并后，从最新的 `main` 创建新分支 |
| 新功能不写测试 | 代码质量无法保证，容易回归 | 功能代码和测试代码一起提交 |

**6. 解决冲突（如有）：**
```bash
# 如果 main 分支有更新，先合并最新代码
git fetch origin
git merge origin/main

# 解决冲突后
git add .
git commit -m "chore: merge main and resolve conflicts"
git push origin feature/your-feature-name
```

**7. 功能开发完整流程（正确示例）：**

```bash
# 1. 切换到 main 并更新
 git checkout main
git pull origin main

# 2. 创建功能分支
git checkout -b feature/my-feature

# 3. 开发功能并编写测试...
# - 修改代码
# - 编写单元测试
# - 确保测试覆盖新功能

# 4. 构建和测试
npm run build
npm test

# 5. 提交代码（包括功能代码和测试代码）
git add .
git commit -m "feat: 新增 xxx 功能

- 功能描述...
- 添加单元测试

Co-Authored-By: xxx"

# 6. 更新版本号（如需要发布）
npm version minor  # 或 patch / major

# 7. 推送分支和标签
git push origin feature/my-feature
git push origin v1.x.x  # 版本标签

# 8. 创建 PR
gh pr create --title "feat: xxx" --body "..."
```

**8. 常见错误修复：**

如果误提交到 `main` 分支：
```bash
# 1. 保存当前提交的哈希值
git log --oneline -1
# 记录 commit hash，例如：abc1234

# 2. 回退 main 分支
git checkout main
git reset --hard HEAD~1  # 回退最近一个提交
# 或回退到远程版本：git reset --hard origin/main

# 3. 创建功能分支并恢复提交
git checkout -b feature/your-feature-name
git cherry-pick abc1234  # 使用刚才记录的 hash

# 4. 推送功能分支
git push origin feature/your-feature-name
```

如果 PR 已合并还继续往旧分支提交：
```bash
# 1. 保存新提交的哈希值（在旧分支上）
git log --oneline -1

# 2. 切换到最新的 main
git checkout main
git pull origin main

# 3. 创建新分支
git checkout -b feature/new-feature

# 4. 将提交移到新分支
git cherry-pick <commit-hash>

# 5. 更新版本号（如需要）
npm version minor

# 6. 推送并创建新 PR
git push origin feature/new-feature
git push origin v1.x.x
gh pr create --title "feat: xxx" --body "..."
```

### 发布流程

项目采用**自动化发布**流程：

**1. 版本管理（⚠️ 重要）：**
- **必须使用 `npm version` 命令更新版本号**
- **禁止手动修改 `package.json` 中的 version 字段**
- `npm version` 会自动：
  - 更新 `package.json` 中的版本号
  - 创建版本提交（如 `1.2.0`）
  - 创建 Git 标签（如 `v1.2.0`）

**2. 发布触发：**
- 当 PR 合并到 `main` 分支时
- 如果版本号发生变化
- GitHub Actions 自动发布到 npm

**3. 版本号规则：**
- `1.0.0` → `1.0.1` (Patch): bug 修复
- `1.0.1` → `1.1.0` (Minor): 新功能
- `1.1.0` → `2.0.0` (Major): 破坏性变更

**4. 预发布版本（可选）：**
```bash
npm version prerelease --preid beta
# 生成 1.0.0-beta.0
```

预发布版本会发布到 npm 的 `beta` tag。

**5. 跳过发布：**
如果 PR 不需要发布，在标题中添加 `[skip release]`：
```
[skip release] chore: 更新文档
```

### CI/CD

**CI 检查（.github/workflows/ci.yml）：**
- 每次 PR 和 push 都会触发
- 运行测试套件
- 构建项目
- 确保代码质量

**Release 自动化（.github/workflows/release.yml）：**
- PR 合并后触发
- 检测版本号变化
- 自动发布到 npm
- 创建 GitHub Release

### 代码规范

**TypeScript：**
- 使用 TypeScript 进行类型检查
- 运行 `npm run build` 检查类型错误

**代码风格：**
- 遵循项目现有代码风格
- 使用有意义的变量和函数名
- 添加必要的注释

**项目结构：**
```
mcps/
├── src/
│   ├── commands/      # 命令实现
│   ├── core/          # 核心功能
│   ├── types/         # 类型定义
│   └── index.ts       # 入口文件
├── test/              # 测试文件
├── dist/              # 构建输出
└── package.json
```

### 常见问题（开发）

**Q: 如何调试代码？**
```bash
# 使用开发模式运行
npm run dev -- start --verbose

# 或构建后直接运行
npm run build
node --inspect dist/index.js <command>
```

**Q: 测试失败了怎么办？**
```bash
# 运行特定测试文件
npm test -- <test-file>

# 查看详细输出
npm test -- --reporter=verbose
```

**Q: 如何本地测试 npm 包？**
```bash
# 在项目根目录
npm link

# 在其他项目中使用
npm link @maplezzk/mcps
mcps ls
```

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
