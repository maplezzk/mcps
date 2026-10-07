# MCP 支持范围

本次升级以 2026-10-07 核实的最新稳定规范 **2026-07-28** 为目标，运行时使用官方 `@modelcontextprotocol/client 2.3.1`。v1 SDK 仅作为开发依赖，用于和真实旧服务进行互操作测试。

规范和迁移依据：

- [MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28)
- [官方变更说明](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/changelog.mdx)
- [SDK v2 迁移指南](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md)
- [新版协议启用指南](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md)

## 已实现并验证

| 能力 | 行为与验证 |
| --- | --- |
| 新版协商与发现 | 默认 `protocolVersion: "auto"`，使用 `server/discover` 选择新版；`mcps discover <server>` 展示协商版本、能力和发现结果 |
| 旧版兼容 | 自动回退到 SDK 支持的旧协议；真实 v1 SDK 服务验证了 2025-11-25；也验证了旧 SSE，显式类型优先于 URL 路径推断 |
| 新版 stdio / Streamable HTTP | HTTP 抓取验证每次请求都携带版本与客户端能力，无 initialize、无 Session-Id；认证错误不会被当作旧版证据 |
| 工具与分页 | `tools/list` 自动汇总所有页；使用 SDK 缓存和失效机制，去掉独立的永久工具缓存 |
| JSON Schema / 结果内容 | SDK 验证 outputSchema；支持数组等任意 JSON structuredContent，以及 audio、resource_link、嵌入资源和 metadata；`--output-json` 保留完整结果 |
| 资源和模板 | `mcps resources <server>`、`--templates`、`mcps read <server> <uri>` |
| 提示词与补全 | `mcps prompts <server>`、`mcps prompt <server> <name> [KEY=VALUE...]`、`mcps complete <server> --json '<params>'` |
| 新版变更订阅 | SDK 自动使用 `subscriptions/listen` 接收工具、资源及提示词列表变更；HTTP 抓取验证订阅请求，stdio 验证新增工具可发现 |
| 新版多轮输入 | 将 input_required 完整交给 CLI 用户，通过 inputResponses 和不透明 requestState 显式续接；不会自动同意表单或 URL 请求 |
| 认证 | headers 支持环境变量占位符；OAuth client_credentials 使用 SDK 发现元数据、获取并复用令牌，校验注册 issuer；通过本地 OAuth 服务测试 |
| 关闭和重连 | SDK 管理 stdio 子进程；测试确认重连后旧 PID 已退出；连接池去重并发请求并阻止重置后的连接复活 |

`auto` 的 stdio 探测使用 SDK 的临时兄弟进程，默认等待至多 2 秒；daemon 复用连接，不会为每次工具调用重复探测。对已知旧服务可配置 `protocolVersion: "legacy"` 跳过探测。配置 `"2026-07-28"` 则强制新版，连接旧服务会明确失败。旧 SSE 只用于兼容旧协议，不能强制新版。

## CLI 配置和错误处理

配置格式为 `{ "mcpServers": { "<name>": { ... } } }`。README 中原先的旧 `servers` 数组示例已修正。

- `mcps config path` / `mcps config validate`：查看有效路径并检查完整配置。
- 根级 daemonTimeout 的单位为毫秒；MCPS_DAEMON_TIMEOUT 环境变量的单位为秒，优先级更高。
- add / update 支持 type、cwd、env、headers、protocolVersion 和 disabled；update 支持 `--enabled` 恢复。
- env/header 按第一个等号拆分，保留空值和后续等号。参数错误返回非零退出码。
- 根级与服务扩展字段在读写过程中保留。损坏 JSON、旧格式或无效现有条目会阻止写入，原始文件不变。
- 写入通过临时文件原子替换，并用独占锁阻止并发覆盖。进程被强制终止时可能留下 `mcp.json.lock`；先确认没有写入进程，再移除遗留锁。
- 修改已连接服务后执行 `mcps restart <server>`。

多轮示例：

```bash
mcps call server approval_tool --output-json
# 退出码 2，返回 inputRequests 和 requestState；根据用户决定填写响应。
mcps call server approval_tool --output-json \
  --request-state '<exact returned state>' \
  --input-responses '{"approval":{"action":"accept","content":{"approved":true}}}'
```

退出码：0 表示完成，1 表示参数、连接、协议或工具级错误，2 表示需要输入后续接。工具返回 isError 时不会提示成功。资源和提示词命令也支持 `--input-responses` / `--request-state`。

OAuth 客户端凭据示例，只保存密钥变量名：

```bash
mcps add remote --type http --url https://mcp.example.com/mcp \
  --oauth-client-id my-client \
  --oauth-client-secret-env MCP_CLIENT_SECRET \
  --oauth-issuer https://auth.example.com \
  --oauth-scope 'mcp:read'
```

## 可选能力与后续范围

支持最新协议版本不等于实现所有可选 host 能力或官方扩展：

- 浏览器 OAuth authorization_code 登录、客户端 ID 元数据文档注册、DPoP 和企业 JWT grant 尚无 CLI 流程；目前提供 headers 和 client_credentials。
- 最新任务机制属于独立的 `io.modelcontextprotocol/tasks` 扩展，本 CLI 未声明或实现该扩展；不会沿用已经移出核心的旧实验任务 API。
- roots、sampling、logging 在最新规范中已弃用；本 CLI 不声明 roots 或 sampling，不包含 LLM 调用。stdio 日志走 stderr/daemon 日志。
- 旧协议 unsolicited elicitation 在后台 daemon 中显式取消；需要人工输入的流程应使用新版多轮交互。
- 自动列表变更订阅已经启用；独立的长期资源内容 watch 命令仍未提供。

这些能力需要各自的产品流程和互操作测试，不能靠增加 capability 标志宣称支持。

## 验证

`npm run check` 执行 TypeScript 编译及全部单元/集成测试；`npm run test:coverage` 输出覆盖率。CLI 子进程使用新编译输出，独立配置目录及随机端口，并清理自己启动的进程。实际协议测试使用官方新旧 SDK，覆盖成功、失败、分页、认证、输入续接和子进程生命周期。

本次在 Node 20.20.2 和 24.19.0 上运行全部 149 项测试，均通过。行覆盖率从升级前的 15.13% 提升到 77.16%；配置模块为 98.68%，MCP 客户端为 93.33%。CI 增加 Node 20/22/24 矩阵及覆盖率门槛：整体行/语句 70%、分支 60%、函数 75%，配置行/分支 90%，客户端行 90% / 分支 75%。

覆盖率统计来自 Vitest 当前进程；独立 CLI 子进程执行的代码不会自动合并进该数字。因此同时审阅覆盖率、进程退出码和真实请求断言，不能仅凭用例数量或总百分比判断完整性。
