import { Command } from 'commander';
import chalk from 'chalk';
import http from 'http';
import { configManager } from '../core/config.js';
import { DaemonClient } from '../core/daemon-client.js';
import { detectServerType } from '../types/config.js';
import { DAEMON_PORT } from '../core/constants.js';

export function parseAssignments(values: string[] = []): Record<string, string> {
  const entries = values.map(value => {
    const index = value.indexOf('=');
    if (index <= 0) throw new Error(`Expected KEY=VALUE, received "${value}"`);
    return [value.slice(0, index), value.slice(index + 1)] as const;
  });
  return Object.fromEntries(entries);
}

function oauthOptions(options: any) {
  if (![options.oauthClientId, options.oauthClientSecretEnv, options.oauthIssuer, options.oauthScope].some(value => value !== undefined)) return undefined;
  if (!options.oauthClientId || !options.oauthClientSecretEnv || !options.oauthIssuer) {
    throw new Error('OAuth requires --oauth-client-id, --oauth-client-secret-env and --oauth-issuer');
  }
  return { type: 'client_credentials' as const, clientId: options.oauthClientId, clientSecretEnv: options.oauthClientSecretEnv, issuer: options.oauthIssuer, scope: options.oauthScope };
}

// Helper function to make HTTP requests to daemon (bypassing proxy)
function daemonRequest(method: string, path: string, body?: string): Promise<{ status: number; ok: boolean; data: any }> {
  return new Promise((resolve, reject) => {
    const port = parseInt(process.env.MCPS_PORT || String(DAEMON_PORT));
    const options = {
      method,
      hostname: '127.0.0.1',
      port,
      path,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode || 500,
            ok: (res.statusCode || 500) >= 200 && (res.statusCode || 500) < 300,
            data: data ? JSON.parse(data) : {},
          });
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

export const registerServerCommands = (program: Command) => {
  const listServersAction = () => {
    try {
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
          const disabled = server.disabled === true;
          const serverType = detectServerType(server);
          const typeColor = serverType === 'stdio' ? chalk.cyan : chalk.yellow;
          const enabledMark = disabled ? chalk.red('✗') : chalk.green('✓');

          // Build command/URL string
          let command = '';
          if ('command' in server && server.command) {
              const args = (server as any).args as string[] | undefined;
              command = `${server.command} ${args?.join(' ') || ''}`;
          } else if ('url' in server && server.url) {
              command = (server as any).url as string;
          }

          return {
              name: server.name,
              type: typeColor(serverType),
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
    } catch (error: any) {
      console.error(chalk.red(error.message));
      process.exitCode = 1;
    }
  };

  const addServerAction = (name: string, options: any) => {
      try {
        if (!['stdio', 'sse', 'http', 'streamableHttp'].includes(options.type)) throw new Error('Unknown server type');
        if (options.command && options.url) throw new Error('Specify command or url, not both');
        const auth = oauthOptions(options);
        if (options.type !== 'stdio' || options.url) {
          if (!options.url) throw new Error(`URL is required for ${options.type || 'HTTP/SSE'} servers`);
          if (options.env?.length || options.cwd || options.args?.length) throw new Error('env, cwd and args require a stdio server');
          configManager.addServer(name, {
            url: options.url,
            type: options.type === 'stdio' ? 'http' : options.type,
            headers: options.header?.length ? parseAssignments(options.header) : undefined,
            auth,
            protocolVersion: options.protocolVersion,
            disabled: options.disabled,
          });
        } else {
          if (!options.command) throw new Error('Command is required for Stdio servers');
          if (options.header?.length || auth) throw new Error('Headers and OAuth require an HTTP/SSE server');

          const env = parseAssignments(options.env);

          configManager.addServer(name, {
            command: options.command,
            args: options.args || [],
            env: Object.keys(env).length > 0 ? env : undefined,
            cwd: options.cwd,
            protocolVersion: options.protocolVersion,
            disabled: options.disabled,
          });
        }
        console.log(chalk.green(`Server "${name}" added successfully.`));
      } catch (error: any) {
        console.error(chalk.red(`Error adding server: ${error.message}`));
        process.exitCode = 1;
      }
  };

  const removeServerAction = (name: string) => {
      try {
        configManager.removeServer(name);
        console.log(chalk.green(`Server "${name}" removed.`));
      } catch (error: any) {
        console.error(chalk.red(error.message));
        process.exitCode = 1;
      }
  };

  const renameServerAction = (oldName: string, newName: string) => {
      try {
        configManager.renameServer(oldName, newName);
        console.log(chalk.green(`Server "${oldName}" renamed to "${newName}".`));
      } catch (error: any) {
        console.error(chalk.red(error.message));
        process.exitCode = 1;
      }
  };

  const updateServerAction = async (name: string | undefined, options: any) => {
      // If no server name provided, refresh all connections
      if (!name) {
          try {
              await DaemonClient.ensureDaemon();

              // Call daemon restart API to restart all connections
              const { ok, data } = await daemonRequest('POST', '/restart', JSON.stringify({}));

              if (ok) {
                  console.log(chalk.green(data.message));
              } else {
                  throw new Error(data.error || 'Failed to restart connections');
              }
          } catch (error: any) {
              console.error(chalk.red(`Failed to restart all servers: ${error.message}`));
              console.error(chalk.yellow('Make sure the daemon is running (use: mcps start)'));
              process.exitCode = 1;
          }
          return;
      }

      // Update specific server configuration
      try {
          const updates: any = {};
          if (options.disabled && options.enabled) throw new Error('Choose either --disabled or --enabled');
          const current = configManager.getServer(name);
          if (!current) throw new Error(`Server with name "${name}" not found.`);
          const transport = options.type ?? (options.url ? 'http' : options.command ? 'stdio' : detectServerType(current));
          const auth = oauthOptions(options);
          if (transport !== 'stdio' && (options.env || options.cwd !== undefined || options.args)) throw new Error('env, cwd and args require a stdio server');
          if (transport === 'stdio' && (options.header || auth)) throw new Error('Headers and OAuth require an HTTP/SSE server');
          if (options.command) updates.command = options.command;
          if (options.args) updates.args = options.args;
          if (options.url) updates.url = options.url;
          if (options.type) updates.type = options.type;
          if (options.cwd !== undefined) updates.cwd = options.cwd;
          if (options.env) updates.env = { ...configManager.getServer(name)?.env as Record<string, string>, ...parseAssignments(options.env) };
          if (options.header) updates.headers = { ...configManager.getServer(name)?.headers as Record<string, string>, ...parseAssignments(options.header) };
          if (options.protocolVersion) updates.protocolVersion = options.protocolVersion;
          if (auth) updates.auth = auth;
          if (options.disabled !== undefined) updates.disabled = options.disabled;
          if (options.enabled) updates.disabled = false;

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
          process.exitCode = 1;
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
    .option('--header <headers...>', 'HTTP headers (KEY=VALUE)')
    .option('--oauth-client-id <id>', 'OAuth client credentials ID')
    .option('--oauth-client-secret-env <name>', 'Environment variable containing the OAuth secret')
    .option('--oauth-issuer <url>', 'Authorization server issuer these credentials belong to')
    .option('--oauth-scope <scope>', 'OAuth scopes')
    .option('--cwd <directory>', 'Working directory for stdio server')
    .option('--protocol-version <version>', 'auto, legacy, or 2026-07-28', 'auto')
    .option('--disabled', 'Disable the server')
    .action(addServerAction);

  // Remove server command
  program.command('remove <name>')
    .alias('rm')
    .description('Remove a server')
    .action(removeServerAction);

  // Rename server command
  program.command('rename <oldName> <newName>')
    .alias('mv')
    .description('Rename a server')
    .action(renameServerAction);

  // Update server command
  program.command('update [name]')
    .description('Update a server configuration or refresh all servers')
    .option('--command <command>', 'New command')
    .option('--args [args...]', 'New arguments for the command')
    .option('--url <url>', 'New URL')
    .option('--type <type>', 'New transport type')
    .option('--env <env...>', 'Merge environment variables (KEY=VALUE)')
    .option('--header <headers...>', 'Merge HTTP headers (KEY=VALUE)')
    .option('--oauth-client-id <id>', 'OAuth client credentials ID')
    .option('--oauth-client-secret-env <name>', 'Environment variable containing the OAuth secret')
    .option('--oauth-issuer <url>', 'Authorization server issuer these credentials belong to')
    .option('--oauth-scope <scope>', 'OAuth scopes')
    .option('--cwd <directory>', 'New stdio working directory')
    .option('--protocol-version <version>', 'auto, legacy, or 2026-07-28')
    .option('--disabled', 'Disable the server')
    .option('--enabled', 'Enable the server')
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
    .option('--header <headers...>', 'HTTP headers (KEY=VALUE)')
    .option('--oauth-client-id <id>', 'OAuth client credentials ID')
    .option('--oauth-client-secret-env <name>', 'Environment variable containing the OAuth secret')
    .option('--oauth-issuer <url>', 'Authorization server issuer these credentials belong to')
    .option('--oauth-scope <scope>', 'OAuth scopes')
    .option('--cwd <directory>', 'Working directory for stdio server')
    .option('--protocol-version <version>', 'auto, legacy, or 2026-07-28', 'auto')
    .option('--disabled', 'Disable the server')
    .action(addServerAction);

  serverCmd.command('remove <name>')
    .alias('rm')
    .description('Remove a server')
    .action(removeServerAction);

  serverCmd.command('rename <oldName> <newName>')
    .alias('mv')
    .description('Rename a server')
    .action(renameServerAction);

  serverCmd.command('update [name]')
    .description('Update a server configuration or refresh all servers')
    .option('--command <command>', 'New command')
    .option('--args [args...]', 'New arguments for the command')
    .option('--url <url>', 'New URL')
    .option('--type <type>', 'New transport type')
    .option('--env <env...>', 'Merge environment variables (KEY=VALUE)')
    .option('--header <headers...>', 'Merge HTTP headers (KEY=VALUE)')
    .option('--oauth-client-id <id>', 'OAuth client credentials ID')
    .option('--oauth-client-secret-env <name>', 'Environment variable containing the OAuth secret')
    .option('--oauth-issuer <url>', 'Authorization server issuer these credentials belong to')
    .option('--oauth-scope <scope>', 'OAuth scopes')
    .option('--cwd <directory>', 'New stdio working directory')
    .option('--protocol-version <version>', 'auto, legacy, or 2026-07-28')
    .option('--disabled', 'Disable the server')
    .option('--enabled', 'Enable the server')
    .action(updateServerAction);

  const config = program.command('config').description('Inspect and validate the configuration file');
  config.command('path').action(() => console.log(configManager.getConfigPath()));
  config.command('validate').action(() => {
    try {
      console.log(`Configuration valid: ${configManager.validateConfig()}`);
    } catch (error: any) {
      console.error(error.message);
      process.exitCode = 1;
    }
  });
};
