import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { configManager } from '../core/config.js';
import { DaemonClient } from '../core/daemon-client.js';

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
    .option('-r, --raw', 'Treat all values as raw strings (no JSON parsing)')
    .option('-j, --json <file>', 'Load parameters from a JSON file')
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

Notes:
  - Arguments are parsed as key=value pairs.
  - By default, values are automatically parsed as JSON if possible (numbers, booleans, objects).
  - Use --raw to disable JSON parsing and treat all values as strings.
  - Use --json to load parameters from a JSON file (overrides command line args).
  - For strings with spaces, wrap the value in quotes (e.g., msg="hello world").
`)
    .action(async (serverName, toolName, args, options) => {
      let params: Record<string, any> = {};

      // Load from JSON file if specified
      if (options.json) {
        try {
          const jsonContent = readFileSync(options.json, 'utf-8');
          params = JSON.parse(jsonContent);
        } catch (error: any) {
          console.error(chalk.red(`Failed to load JSON file: ${error.message}`));
          process.exit(1);
        }
      } else if (args) {
        // Parse command line arguments
        args.forEach((arg: string) => {
          const eqIndex = arg.indexOf('=');
          if (eqIndex > 0) {
            const key = arg.slice(0, eqIndex);
            const valStr = arg.slice(eqIndex + 1);
            
            if (options.raw) {
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
      }

      // Check if server exists in config first
      const serverConfig = configManager.getServer(serverName);
      if (!serverConfig) {
        console.error(chalk.red(`Server "${serverName}" not found in config.`));
        process.exit(1);
      }

      try {
        // Auto-start daemon if needed
        await DaemonClient.ensureDaemon();
        
        // Execute via daemon
        const result = await DaemonClient.executeTool(serverName, toolName, params);
        console.log(chalk.green('Tool execution successful:'));
        printResult(result);

      } catch (error: any) {
         console.error(chalk.red(`Execution failed: ${error.message}`));
         process.exit(1);
      }
    });
};

