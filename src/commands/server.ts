import { Command } from 'commander';
import chalk from 'chalk';
import { configManager } from '../core/config.js';
import { DaemonClient } from '../core/daemon-client.js';

export const registerServerCommands = (program: Command) => {
  const listServersAction = () => {
      const servers = configManager.listServers();
      if (servers.length === 0) {
        console.log(chalk.yellow('No servers configured.'));
        return;
      }

      // Helper function to calculate display width (Chinese chars count as 2)
      const getDisplayWidth = (str: string): number => {
          let width = 0;
          for (const char of str) {
              if (char.charCodeAt(0) > 127) {
                  width += 2;
              } else {
                  width += 1;
              }
          }
          return width;
      };

      // Helper function to pad string considering Chinese characters
      const padEndWidth = (str: string, targetWidth: number): string => {
          const displayWidth = getDisplayWidth(str);
          const padding = Math.max(0, targetWidth - displayWidth);
          return str + ' '.repeat(padding);
      };

      // Build table rows
      const rows = servers.map(server => {
          const disabled = (server as any).disabled === true;
          const typeColor = server.type === 'stdio' ? chalk.cyan : chalk.yellow;
          const enabledMark = disabled ? chalk.red('✗') : chalk.green('✓');

          // Build command/URL string
          let command = '';
          if (server.type === 'stdio') {
              command = `${server.command} ${server.args.join(' ')}`;
          } else {
              command = server.url || '';
          }

          return {
              name: server.name,
              type: typeColor(server.type),
              enabled: enabledMark,
              command: command,
              disabled
          };
      });

      // Calculate column widths
      const nameWidth = Math.max(4, ...rows.map(r => getDisplayWidth(r.name)));
      const typeWidth = 6;
      const enabledWidth = 7;
      const commandWidth = Math.max(7, ...rows.map(r => getDisplayWidth(r.command)));

      // Print table header
      console.log('');
      console.log(chalk.bold(`${'NAME'.padEnd(nameWidth)}  ${'TYPE'.padEnd(typeWidth)}  ${'ENABLED'.padEnd(enabledWidth)}  ${'COMMAND/URL'}`));
      console.log(chalk.gray('─'.repeat(nameWidth) + '  ' + '─'.repeat(typeWidth) + '  ' + '─'.repeat(enabledWidth) + '  ' + '─'.repeat(commandWidth)));

      // Print table rows
      rows.forEach(row => {
          console.log(`${padEndWidth(row.name, nameWidth)}  ${String(row.type).padEnd(typeWidth)}  ${String(row.enabled).padEnd(enabledWidth)}  ${row.command}`);
      });

      console.log('');
      console.log(chalk.cyan(`Total: ${servers.length} server(s)`));
      console.log('');
  };

  const addServerAction = (name: string, options: any) => {
      try {
        if (options.type === 'sse' || options.type === 'http') {
          if (!options.url) throw new Error(`URL is required for ${options.type} servers`);
          configManager.addServer({
            name,
            type: options.type,
            url: options.url,
          });
        } else {
          if (!options.command) throw new Error('Command is required for Stdio servers');

          const env: Record<string, string> = {};
          if (options.env) {
            options.env.forEach((e: string) => {
               const parts = e.split('=');
               const k = parts[0];
               const v = parts.slice(1).join('=');
               if (k && v) env[k] = v;
            });
          }

          configManager.addServer({
            name,
            type: 'stdio',
            command: options.command,
            args: options.args || [],
            env: Object.keys(env).length > 0 ? env : undefined,
          });
        }
        console.log(chalk.green(`Server "${name}" added successfully.`));
      } catch (error: any) {
        console.error(chalk.red(`Error adding server: ${error.message}`));
      }
  };

  const removeServerAction = (name: string) => {
      try {
        configManager.removeServer(name);
        console.log(chalk.green(`Server "${name}" removed.`));
      } catch (error: any) {
        console.error(chalk.red(error.message));
      }
  };

  const updateServerAction = async (name: string | undefined, options: any) => {
      // If no server name provided, refresh all connections
      if (!name) {
          try {
              await DaemonClient.ensureDaemon();

              // Call daemon restart API to refresh all connections
              const port = parseInt(process.env.MCPS_PORT || '4100');
              const res = await fetch(`http://localhost:${port}/restart`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({})
              });

              if (res.ok) {
                  const data = await res.json();
                  console.log(chalk.green(data.message));
                  console.log(chalk.gray('All servers will be reconnected on next use.'));
              } else {
                  throw new Error('Failed to refresh connections');
              }
          } catch (error: any) {
              console.error(chalk.red(`Failed to refresh all servers: ${error.message}`));
              console.error(chalk.yellow('Make sure the daemon is running (use: mcps start)'));
          }
          return;
      }

      // Update specific server configuration
      try {
          const updates: any = {};
          if (options.command) updates.command = options.command;
          if (options.args) updates.args = options.args;
          if (options.url) updates.url = options.url;

          if (Object.keys(updates).length === 0) {
              console.log(chalk.yellow('No updates provided.'));
              console.log(chalk.gray('Use: mcps update <server> --command <cmd> --args <args>'));
              return;
          }

          configManager.updateServer(name, updates);
          console.log(chalk.green(`Server "${name}" updated.`));
          console.log(chalk.gray('Note: Restart the daemon to apply changes: mcps restart'));
      } catch (error: any) {
          console.error(chalk.red(`Error updating server: ${error.message}`));
      }
  };

  // ===== Top-level commands (new, simplified) =====

  // List command (already exists, keeping as-is)
  program.command('list')
    .alias('ls')
    .description('List all configured servers')
    .action(listServersAction);

  // Add server command
  program.command('add <name>')
    .description('Add a new MCP server')
    .option('--type <type>', 'Server type (stdio, sse, or http)', 'stdio')
    .option('--command <command>', 'Command to execute (for stdio)')
    .option('--args [args...]', 'Arguments for the command', [])
    .option('--url <url>', 'URL for SSE/HTTP connection')
    .option('--env <env...>', 'Environment variables (KEY=VALUE)', [])
    .action(addServerAction);

  // Remove server command
  program.command('remove <name>')
    .alias('rm')
    .description('Remove a server')
    .action(removeServerAction);

  // Update server command
  program.command('update [name]')
    .description('Update a server configuration or refresh all servers')
    .option('--command <command>', 'New command')
    .option('--args [args...]', 'New arguments for the command')
    .option('--url <url>', 'New URL')
    .action(updateServerAction);

  // ===== Legacy server subcommands (for backward compatibility) =====

  const serverCmd = program.command('server')
    .description('Manage MCP servers (legacy, use top-level commands)');

  serverCmd.command('list')
    .alias('ls')
    .description('List all configured servers')
    .action(listServersAction);

  serverCmd.command('add <name>')
    .description('Add a new MCP server')
    .option('--type <type>', 'Server type (stdio, sse, or http)', 'stdio')
    .option('--command <command>', 'Command to execute (for stdio)')
    .option('--args [args...]', 'Arguments for the command', [])
    .option('--url <url>', 'URL for SSE/HTTP connection')
    .option('--env <env...>', 'Environment variables (KEY=VALUE)', [])
    .action(addServerAction);

  serverCmd.command('remove <name>')
    .alias('rm')
    .description('Remove a server')
    .action(removeServerAction);

  serverCmd.command('update [name]')
    .description('Update a server configuration or refresh all servers')
    .option('--command <command>', 'New command')
    .option('--args [args...]', 'New arguments for the command')
    .option('--url <url>', 'New URL')
    .action(updateServerAction);
};
