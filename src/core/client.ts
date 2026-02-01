import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ServerConfig } from '../types/config.js';
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
    this.serverType = config.type;
    this.daemonPid = process.pid;

    try {
      if (config.type === 'stdio') {
        // 保存命令和参数用于后续清理进程
        this.serverCommand = config.command;
        this.serverArgs = config.args || [];

        const resolvedConfigEnv: Record<string, string> = {};
        if (config.env) {
          for (const key in config.env) {
            const val = config.env[key];
            if (typeof val === 'string') {
              resolvedConfigEnv[key] = resolveEnvPlaceholders(val);
            }
          }
        }

        const rawEnv = config.env ? { ...process.env, ...resolvedConfigEnv } : process.env;
        const env: Record<string, string> = {};
        for (const key in rawEnv) {
            const val = rawEnv[key];
            if (typeof val === 'string') {
                env[key] = val;
            }
        }

        const args = config.args ? config.args.map(arg => resolveEnvPlaceholders(arg)) : [];
        this.transport = new StdioClientTransport({
          command: config.command,
          args,
          env: env,
        });
      } else if (config.type === 'http') {
        const url = resolveEnvPlaceholders(config.url);
        this.transport = new StreamableHTTPClientTransport(new URL(url));
      } else {
        const url = resolveEnvPlaceholders(config.url);
        this.transport = new SSEClientTransport(new URL(url));
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
      if (config.type === 'stdio') {
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
            // 调试日志已移除
          }
        } catch {
          // 进程可能已经不存在了
        }
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
    return this.client.callTool({
      name: toolName,
      arguments: args,
    });
  }

  close() {
    // 对于 stdio 类型的服务器，先杀掉子进程（在关闭 transport 之前）
    if (this.serverType === 'stdio' && this.childPids.size > 0) {
      log(`[Daemon] Closing ${this.serverName}, killing ${this.childPids.size} child process(es)...`);

      // 直接使用 SIGKILL，确保进程被终止
      for (const pid of this.childPids) {
        try {
          process.kill(pid, 'SIGKILL');
          log(`[Daemon] SIGKILLED child process ${pid} (${this.serverName})`);
        } catch (e) {
          log(`[Daemon] Failed to kill ${pid}: ${e}`);
        }
      }

      this.childPids.clear();
      log(`[Daemon] All child processes cleared for ${this.serverName}`);
    }

    // 暂时不关闭 transport，避免卡住
    log(`[Daemon] ${this.serverName} close() completed`);
  }
}
