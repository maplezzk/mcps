#!/usr/bin/env node
import { Command } from 'commander';
import { registerServerCommands } from './commands/server.js';
import { registerToolsCommand } from './commands/tools.js';
import { registerCallCommand } from './commands/call.js';
import { registerDaemonCommand } from './commands/daemon.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const program = new Command();

program
  .name('mcps')
  .description('A CLI to manage and use MCP servers')
  .version(pkg.version);

registerServerCommands(program);
registerToolsCommand(program);
registerCallCommand(program);
registerDaemonCommand(program);

program.parse(process.argv);
