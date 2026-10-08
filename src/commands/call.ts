import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { configManager } from '../core/config.js';
import { DaemonClient } from '../core/daemon-client.js';

/**
 * Parse call command arguments
 * @param args - Command line arguments in key=value format
 * @param raw - Whether to treat all values as raw strings
 * @returns Parsed parameters object
 */
export function parseCallArgs(args: string[] | undefined, raw: boolean): Record<string, any> {
  const params: Record<string, any> = {};
  
  if (!args) return params;
  
  args.forEach((arg: string) => {
    const eqIndex = arg.indexOf('=');
    if (eqIndex > 0) {
      const key = arg.slice(0, eqIndex);
      const valStr = arg.slice(eqIndex + 1);
      
      if (raw) {
        // --raw mode: treat all values as strings
        params[key] = valStr;
      } else {
        // Default mode: try JSON parsing
        try {
          params[key] = JSON.parse(valStr);
        } catch {
          params[key] = valStr;
        }
      }
    }
  });
  
  return params;
}

/**
 * Load parameters from JSON string or file
 * @param jsonValue - JSON string (starts with { or [) or file path
 * @returns Parsed parameters object
 */
export function loadJsonParams(jsonValue: string): Record<string, any> {
  const trimmed = jsonValue.trim();
  // Check if it's a JSON string (starts with { or [)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(jsonValue);
  } else {
    // Treat as file path
    const jsonContent = readFileSync(jsonValue, 'utf-8');
    return JSON.parse(jsonContent);
  }
}

export function printResult(result: any) {
    if (result.resultType === 'input_required') {
        console.log(JSON.stringify(result, null, 2));
        return;
    }
    if (result.content) {
        (result.content as any[]).forEach((item: any) => {
            if (item.type === 'text') {
                console.log(item.text);
            } else if (item.type === 'image') {
                console.log(`[Image: ${item.mimeType}]`);
            } else if (item.type === 'audio') {
                console.log(`[Audio: ${item.mimeType}]`);
            } else if (item.type === 'resource_link') {
                console.log(`[Resource: ${item.uri}]`);
            } else if (item.type === 'resource') {
                console.log(item.resource.text ?? `[Resource: ${item.resource.uri}]`);
            }
        });
    }
    if (result.structuredContent !== undefined) {
        const alreadyPrinted = result.content?.some((item: any) => {
          if (item.type !== 'text') return false;
          try { return JSON.stringify(JSON.parse(item.text)) === JSON.stringify(result.structuredContent); }
          catch { return false; }
        });
        if (!alreadyPrinted) console.log(JSON.stringify(result.structuredContent, null, 2));
    } else if (!result.content) {
            console.log(JSON.stringify(result, null, 2));
    }
}

export const registerCallCommand = (program: Command) => {
  program.command('call <server> <tool> [args...]')
    .description('Call a tool on a server. Arguments format: key=value')
    .option('-r, --raw', 'Treat all values as raw strings (no JSON parsing)')
    .option('-j, --json <file>', 'Load parameters from a JSON file')
    .option('--output-json', 'Output the complete MCP result without losing content or metadata')
    .option('--input-responses <json>', 'MCP input responses as a JSON object or file')
    .option('--request-state <state>', 'Opaque MCP request state returned by the server')
    .option('-t, --timeout <seconds>', 'Request timeout in seconds (default: 300)')
    .addHelpText('after', `
Examples:
  $ mcps call my-server echo message="Hello World"
  $ mcps call my-server add a=10 b=20
  $ mcps call my-server config debug=true
  $ mcps call my-server createUser user='{"name":"Alice","age":30}'

  # Use --raw to treat all values as strings
  $ mcps call my-server createUser --raw id="123" name="Alice"

  # Use --json to load parameters from a file
  $ mcps call my-server createUser --json params.json

  # Use --timeout to set custom request timeout (in seconds)
  $ mcps call my-server download_label order_id="123" --timeout 180

Notes:
  - Arguments are parsed as key=value pairs.
  - By default, values are automatically parsed as JSON if possible (numbers, booleans, objects).
  - Use --raw to disable JSON parsing and treat all values as strings.
  - Use --json to load parameters from a JSON file or JSON string.
  - Use --timeout to override the default 300s request timeout.
  - For strings with spaces, wrap the value in quotes (e.g., msg="hello world").
`)
    .action(async (serverName, toolName, args, options) => {
      let params: Record<string, any> = {};

      // Load from JSON file or string if specified
      if (options.json) {
        try {
          params = loadJsonParams(options.json as string);
        } catch (error: any) {
          console.error(chalk.red(`Failed to parse JSON: ${error.message}`));
          process.exitCode = 1;
          return;
        }
      } else {
        params = parseCallArgs(args, options.raw);
      }

      try {
        if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('Tool arguments must be a JSON object');
        const serverConfig = configManager.getServer(serverName);
        if (!serverConfig) throw new Error(`Server "${serverName}" not found in config.`);
        if (serverConfig.disabled) throw new Error(`Server "${serverName}" is disabled.`);
        const seconds = Number(options.timeout ?? 300);
        if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Request timeout must be positive');
        const continuation = options.inputResponses ? loadJsonParams(options.inputResponses) : undefined;
        if (continuation && (typeof continuation !== 'object' || Array.isArray(continuation))) throw new Error('Input responses must be a JSON object');
        // Auto-start daemon if needed
        await DaemonClient.ensureDaemon();
        
        // Parse timeout option (convert seconds to ms for SDK, default 5min = 300s)
        const timeout = seconds * 1000;
        
        // Execute via daemon
        const result = await DaemonClient.executeTool(serverName, toolName, params, timeout, { inputResponses: continuation, requestState: options.requestState });
        if (options.outputJson) console.log(JSON.stringify(result, null, 2));
        else {
          if (result.resultType !== 'input_required') console.log(result.isError ? chalk.red('Tool execution failed:') : chalk.green('Tool execution successful:'));
          printResult(result);
        }
        if (result.isError) process.exitCode = 1;
        if (result.resultType === 'input_required') process.exitCode = 2;

      } catch (error: any) {
         console.error(chalk.red(`Execution failed: ${error.message}`));
         process.exitCode = 1;
      }
    });
};
