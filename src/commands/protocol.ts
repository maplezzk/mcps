import { Command } from 'commander';
import { DaemonClient } from '../core/daemon-client.js';
import { configManager } from '../core/config.js';
import { type ProtocolOperation } from '../core/client.js';
import { loadJsonParams, parseCallArgs } from './call.js';

export function registerProtocolCommands(program: Command) {
  const invoke = async (server: string, operation: ProtocolOperation, params: Record<string, unknown> = {}) => {
    try {
      const configured = configManager.getServer(server);
      if (!configured) throw new Error(`Server "${server}" not found in config.`);
      if (configured.disabled) throw new Error(`Server "${server}" is disabled.`);
      await DaemonClient.ensureDaemon();
      const result: any = await DaemonClient.request(server, operation, params);
      console.log(JSON.stringify(result, null, 2));
      if (result.resultType === 'input_required') process.exitCode = 2;
    } catch (error: any) {
      console.error(error.message);
      process.exitCode = 1;
    }
  };
  const continuation = (options: any) => ({
    ...(options.requestState !== undefined ? { requestState: options.requestState } : {}),
    ...(options.inputResponses ? { inputResponses: loadJsonParams(options.inputResponses) } : {}),
  });
  const continuable = (command: Command) => command
    .option('--input-responses <json>', 'JSON input responses or file for a multi-round-trip request')
    .option('--request-state <state>', 'Opaque request state returned by the server');
  program.command('discover <server>').description('Show negotiated MCP protocol, server capabilities and discovery result')
    .action(server => invoke(server, 'info'));
  program.command('resources <server>').description('List all MCP resources or resource templates')
    .option('--templates', 'List resource templates')
    .action((server, options) => invoke(server, options.templates ? 'resources/templates/list' : 'resources/list'));
  continuable(program.command('read <server> <uri>').description('Read an MCP resource'))
    .action(async (server, uri, options) => {
      try { await invoke(server, 'resources/read', { uri, ...continuation(options) }); }
      catch (error: any) { console.error(error.message); process.exitCode = 1; }
    });
  program.command('prompts <server>').description('List all MCP prompts')
    .action(server => invoke(server, 'prompts/list'));
  continuable(program.command('prompt <server> <name> [args...]').description('Get an MCP prompt with string KEY=VALUE arguments'))
    .option('-j, --json <json>', 'Prompt arguments as JSON or a file')
    .action(async (server, name, args, options) => {
      try {
        const values = options.json ? loadJsonParams(options.json) : parseCallArgs(args, true);
        if (!values || typeof values !== 'object' || Array.isArray(values) || Object.values(values).some(value => typeof value !== 'string')) {
          throw new Error('Prompt arguments must be a JSON object with string values');
        }
        await invoke(server, 'prompts/get', { name, arguments: values, ...continuation(options) });
      } catch (error: any) { console.error(error.message); process.exitCode = 1; }
    });
  program.command('complete <server>').description('Complete a prompt or resource-template argument')
    .requiredOption('-j, --json <json>', 'MCP completion parameters as JSON or a file')
    .action(async (server, options) => {
      try { await invoke(server, 'completion/complete', loadJsonParams(options.json)); }
      catch (error: any) { console.error(error.message); process.exitCode = 1; }
    });
}
