import { Command } from 'commander';
import chalk from 'chalk';
import { configManager } from '../core/config.js';
import { McpClientService } from '../core/client.js';

const DAEMON_PORT = 4100;

async function tryCallDaemon(serverName: string, toolName: string, args: any): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${DAEMON_PORT}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server: serverName, tool: toolName, args }),
    });

    if (!response.ok) {
        // If daemon returns error, we might want to show it or fallback?
        // Let's assume 500 means daemon tried and failed, so we shouldn't fallback to local spawn as it might fail same way.
        // But if 404/Connection Refused, then daemon is not running.
        // fetch throws on connection refused.
        const err = await response.json();
        throw new Error(err.error || 'Daemon error');
    }

    const data = await response.json();
    console.log(chalk.green('Tool execution successful (via Daemon):'));
    printResult(data.result);
    return true;
  } catch (error: any) {
    // If connection failed (daemon not running), return false to fallback
    if (error.cause?.code === 'ECONNREFUSED' || error.message.includes('fetch failed')) {
      return false;
    }
    // If daemon connected but returned error (e.g. tool failed), rethrow
    throw error;
  }
}

function printResult(result: any) {
    if (result.content) {
        (result.content as any[]).forEach((item: any) => {
            if (item.type === 'text') {
                console.log(item.text);
            } else if (item.type === 'image') {
                console.log(`[Image: ${item.mimeType}]`);
            } else if (item.type === 'resource') {
                console.log(`[Resource: ${item.resource.uri}]`);
            }
        });
    } else {
            console.log(JSON.stringify(result, null, 2));
    }
}

export const registerCallCommand = (program: Command) => {
  program.command('call <server> <tool> [args...]')
    .description('Call a tool on a server. Arguments format: key=value')
    .addHelpText('after', `
Examples:
  $ mcps call my-server echo message="Hello World"
  $ mcps call my-server add a=10 b=20
  $ mcps call my-server config debug=true
  $ mcps call my-server createUser user='{"name":"Alice","age":30}'

Notes:
  - Arguments are parsed as key=value pairs.
  - Values are automatically parsed as JSON if possible (numbers, booleans, objects).
  - If JSON parsing fails, the value is treated as a string.
  - For strings with spaces, wrap the value in quotes (e.g., msg="hello world").
`)
    .action(async (serverName, toolName, args) => {
      const params: Record<string, any> = {};
      if (args) {
          args.forEach((arg: string) => {
              const eqIndex = arg.indexOf('=');
              if (eqIndex > 0) {
                  const key = arg.slice(0, eqIndex);
                  const valStr = arg.slice(eqIndex + 1);
                  try {
                      params[key] = JSON.parse(valStr);
                  } catch {
                      params[key] = valStr;
                  }
              }
          });
      }

      // 1. Try Daemon first
      try {
        const handled = await tryCallDaemon(serverName, toolName, params);
        if (handled) return;
      } catch (error: any) {
         console.error(chalk.red(`Daemon call failed: ${error.message}`));
         process.exit(1);
      }

      // 2. Fallback to standalone execution
      const serverConfig = configManager.getServer(serverName);
      if (!serverConfig) {
        console.error(chalk.red(`Server "${serverName}" not found.`));
        process.exit(1);
      }

      const client = new McpClientService();
      try {
        await client.connect(serverConfig);
        const result = await client.callTool(toolName, params);
        
        console.log(chalk.green('Tool execution successful:'));
        printResult(result);

      } catch (error: any) {
        console.error(chalk.red(`Tool call failed: ${error.message}`));
      } finally {
        await client.close();
      }
    });
};

