import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ServerConfig, detectServerType } from '../types/config.js';
import { EventSource } from 'eventsource';
import { spawn } from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

// 日志文件路径
const logFile = path.join(process.env.HOME || '~', '.mcps', 'daemon.log');

// 日志函数（异步，避免阻塞）
const log = (message: string) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  try {
    fs.appendFileSync(logFile, logMessage);
  } catch (e) {
    // 忽略日志写入错误
  }
  try {
    console.log(message);
  } catch (e) {
    // 忽略 console 错误
  }
};

// Required for SSEClientTransport in Node.js environment
// @ts-ignore
global.EventSource = EventSource;

const resolveEnvPlaceholders = (input: string) => {
  const missing = new Set<string>();
  const resolved = input.replace(/\$\{([A-Za-z0-9_]+)\}|\$([A-Za-z0-9_]+)/g, (match, braced, bare) => {
    const key = braced || bare;
    const val = process.env[key];
    if (val === undefined) {
      missing.add(key);
      return match;
    }
    return val;
  });
  if (missing.size > 0) {
    const list = Array.from(missing).join(', ');
    throw new Error(`Missing environment variables: ${list}`);
  }
  return resolved;
};

export class McpClientService {
  private client: Client | null = null;
  private transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport | null = null;
  private serverName: string = '';
  private serverType: string = '';
  private serverCommand: string = '';
  private serverArgs: string[] = [];
  private daemonPid: number = process.pid;
  private childPids: Set<number> = new Set();
  private static globalPidsBeforeConnection: Set<number> = new Set();

  async connect(config: ServerConfig, serverName: string = '') {
    this.serverName = serverName;
    const serverType = detectServerType(config);
    this.serverType = serverType;
    this.daemonPid = process.pid;

    try {
      if (serverType === 'stdio' && 'command' in config) {
        const stdioConfig = config as { command: string; args?: string[]; env?: Record<string, string> };
        // 保存命令和参数用于后续清理进程
        this.serverCommand = stdioConfig.command;
        this.serverArgs = stdioConfig.args || [];

        const resolvedConfigEnv: Record<string, string> = {};
        if (stdioConfig.env) {
          for (const key in stdioConfig.env) {
            const val = stdioConfig.env[key];
            if (typeof val === 'string') {
              resolvedConfigEnv[key] = resolveEnvPlaceholders(val);
            }
          }
        }

        const rawEnv = stdioConfig.env ? { ...process.env, ...resolvedConfigEnv } : process.env;
        const env: Record<string, string> = {};
        for (const key in rawEnv) {
            const val = rawEnv[key];
            if (typeof val === 'string') {
                env[key] = val;
            }
        }

        const args = stdioConfig.args ? stdioConfig.args.map(arg => resolveEnvPlaceholders(arg)) : [];
        this.transport = new StdioClientTransport({
          command: stdioConfig.command,
          args,
          env: env,
        });
      } else if (serverType === 'http' && 'url' in config) {
        const url = resolveEnvPlaceholders((config as { url: string }).url);
        this.transport = new StreamableHTTPClientTransport(new URL(url));
      } else if ('url' in config) {
        const url = resolveEnvPlaceholders((config as { url: string }).url);
        this.transport = new SSEClientTransport(new URL(url));
      } else {
        throw new Error('Invalid server configuration: must have either command (for stdio) or url (for sse/http)');
      }

      this.client = new Client(
        {
          name: 'mcp-cli',
          version: '1.0.0',
        },
        {
          capabilities: {},
        }
      );

      await this.client.connect(this.transport);

      // 连接成功后，立即查找并保存子进程 PID
      if ('command' in config) {
        await this.recordChildPids();
      }
    } catch (error) {
      // Error will be handled by the caller
      throw error;
    }
  }

  // 记录子进程 PID（使用快照差异法）
  private async recordChildPids() {
    try {
      // 获取连接前的所有子进程快照
      const getSnapshot = async (): Promise<Set<number>> => {
        const pids = new Set<number>();
        const getAllDescendants = async (parentPid: number): Promise<void> => {
          try {
            const { stdout } = await execAsync(`pgrep -P ${parentPid}`);
            const childPids = stdout.trim().split('\n').filter(pid => pid);
            for (const pid of childPids) {
              pids.add(parseInt(pid));
              await getAllDescendants(parseInt(pid));
            }
          } catch {
            // 没有子进程
          }
        };
        await getAllDescendants(this.daemonPid);
        return pids;
      };

      // 记录连接前的快照（第一次连接时为空）
      const beforeSnapshot = new Set(McpClientService.globalPidsBeforeConnection);

      // 等待一小段时间，确保子进程完全启动
      await new Promise(resolve => setTimeout(resolve, 500));

      // 获取连接后的快照
      const afterSnapshot = await getSnapshot();

      // 找出差异（新启动的进程）
      const newPids = new Set<number>();
      for (const pid of afterSnapshot) {
        if (!beforeSnapshot.has(pid)) {
          newPids.add(pid);
        }
      }

      // 更新全局快照
      McpClientService.globalPidsBeforeConnection = afterSnapshot;

      // 过滤出匹配我们命令的进程
      const commandBaseName = this.serverCommand.split('/').pop() || this.serverCommand;

      const verbose = process.env.MCPS_VERBOSE === 'true';
      if (verbose) {
        log(`[Daemon] ${this.serverName}: Found ${newPids.size} new PIDs: [${Array.from(newPids).join(', ')}]`);
      }

      for (const pid of newPids) {
        try {
          const { stdout: cmdOutput } = await execAsync(`ps -p ${pid} -o command=`);
          const cmdLine = cmdOutput.trim();

          // 检查命令行是否匹配
          const isMatch =
            cmdLine.includes(commandBaseName) ||
            cmdLine.includes('npm exec') ||  // npx 会转换成 npm exec
            cmdLine.includes('npx') ||
            (this.serverArgs.length > 0 && this.serverArgs.some(arg => {
              return cmdLine.includes(arg) && arg.length > 10;
            }));

          if (isMatch) {
            this.childPids.add(pid);
            if (verbose) {
              log(`[Daemon] ${this.serverName}: Added PID ${pid} to childPids (cmd: ${cmdLine.substring(0, 50)}...)`);
            }
          }
        } catch {
          // 进程可能已经不存在了
        }
      }

      if (verbose) {
        log(`[Daemon] ${this.serverName}: Total childPids after collection: ${this.childPids.size}`);
      }
    } catch (e) {
      // 记录失败，不影响主流程
      console.error(`[Daemon] Failed to record child PIDs: ${e}`);
    }
  }

  async listTools() {
    if (!this.client) throw new Error('Client not connected');
    return this.client.listTools();
  }

  async callTool(toolName: string, args: any) {
    if (!this.client) throw new Error('Client not connected');

    // 记录工具调用请求
    log(`[Tool Request] Server: ${this.serverName}, Tool: ${toolName}, Args: ${JSON.stringify(args)}`);

    const result = await this.client.callTool({
      name: toolName,
      arguments: args,
    });

    // 记录工具调用响应
    log(`[Tool Response] Server: ${this.serverName}, Tool: ${toolName}, Result: ${JSON.stringify(result)}`);

    return result;
  }

  close() {
    const verbose = process.env.MCPS_VERBOSE === 'true';

    // 对于 stdio 类型的服务器，先杀掉子进程（在关闭 transport 之前）
    if (this.serverType === 'stdio' && this.childPids.size > 0) {
      const pidList = Array.from(this.childPids).join(', ');
      if (verbose) {
        log(`[Daemon] Closing ${this.serverName}, killing PIDs: [${pidList}]`);
      } else {
        // 简短版本，始终显示
        log(`[Daemon] Closing ${this.serverName} (${this.childPids.size} process(es))`);
      }

      // 直接使用 SIGKILL，确保进程被终止
      for (const pid of this.childPids) {
        try {
          process.kill(pid, 'SIGKILL');
          if (verbose) {
            log(`[Daemon] SIGKILLED child process ${pid} (${this.serverName})`);
          }
        } catch (e: any) {
          if (verbose) {
            log(`[Daemon] Failed to kill ${pid}: ${e.message}`);
          }
        }
      }

      this.childPids.clear();
      if (verbose) {
        log(`[Daemon] All child processes cleared for ${this.serverName}`);
      }
    } else {
      if (verbose) {
        log(`[Daemon] No child PIDs to kill for ${this.serverName} (childPids.size: ${this.childPids.size})`);
      }
    }

    // 暂时不关闭 transport，避免卡住
    if (verbose) {
      log(`[Daemon] ${this.serverName} close() completed`);
    }
  }
}
