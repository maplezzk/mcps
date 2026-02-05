import { Command } from 'commander';
import chalk from 'chalk';
import { configManager } from '../core/config.js';
import { DaemonClient } from '../core/daemon-client.js';

function printProperty(key: string, value: any, required: boolean, indent: number) {
    const indentStr = '  '.repeat(indent);
    const requiredMark = required ? chalk.red('*') : '';
    const desc = value.description ? ` (${value.description})` : '';

    if (value.type === 'object' && value.properties) {
        console.log(`${indentStr}${key}${requiredMark}: object${desc}`);
        const nestedRequired = value.required || [];
        Object.entries(value.properties).forEach(([nestedKey, nestedValue]: [string, any]) => {
            printProperty(nestedKey, nestedValue as any, nestedRequired.includes(nestedKey), indent + 1);
        });
    } else {
        let typeInfo = value.type || 'any';
        if (value.type === 'array' && value.items) {
            const itemType = value.items.type || 'any';
            typeInfo = `array of ${itemType}`;
        }
        if (value.enum) {
            const enumValues = value.enum.map((v: any) => typeof v === 'string' ? `"${v}"` : String(v)).join(', ');
            typeInfo += ` [${enumValues}]`;
        }
        console.log(`${indentStr}${key}${requiredMark}: ${typeInfo}${desc}`);
    }
}

function printTools(serverName: string, tools: any) {
    console.log(chalk.bold(`\nAvailable Tools for ${serverName}:`));
    if (!tools || tools.length === 0) {
        console.log(chalk.yellow('No tools found.'));
    } else {
        tools.forEach((tool: any) => {
            console.log(chalk.cyan(`\n- ${tool.name}`));
            if (tool.description) {
                console.log(`  ${tool.description}`);
            }
            console.log(chalk.gray('  Arguments:'));
            const schema = tool.inputSchema as any;
            if (schema.properties) {
                const required = schema.required || [];
                Object.entries(schema.properties).forEach(([key, value]: [string, any]) => {
                    printProperty(key, value, required.includes(key), 2);
                });
            } else {
                console.log('    None');
            }
        });
    }
}

export const registerToolsCommand = (program: Command) => {
  program.command('tools <server>')
    .description('List available tools on a server')
    .option('-s, --simple', 'Show only tool names')
    .option('-j, --json', 'Output raw JSON')
    .option('-t, --tool <name...>', 'Filter tools by name(s)')
    .action(async (serverName, options) => {
      // Check if server exists in config first
      const serverConfig = configManager.getServer(serverName);
      if (!serverConfig) {
        console.error(chalk.red(`Server "${serverName}" not found in config.`));
        process.exit(1);
      }

      try {
        // Auto-start daemon if needed
        await DaemonClient.ensureDaemon();

        // List via daemon
        let tools = await DaemonClient.listTools(serverName);

        // Filter by tool names if specified
        if (options.tool && options.tool.length > 0) {
          const filters = Array.isArray(options.tool) ? options.tool : [options.tool];
          tools = tools.filter((tool: any) =>
            filters.some((filter: string) =>
              tool.name.toLowerCase().includes(filter.toLowerCase())
            )
          );
        }

        if (!tools || tools.length === 0) {
          console.log(chalk.yellow('No tools found.'));
          return;
        }

        if (options.json) {
          // Raw JSON output
          console.log(JSON.stringify(tools, null, 2));
          return;
        }

        if (options.simple) {
          // Simple mode: only show tool names
          tools.forEach((tool: any) => console.log(tool.name));
          console.log(chalk.gray(`\nTotal: ${tools.length} tool(s)`));
        } else {
          // Detailed mode: show full tool information
          printTools(serverName, tools);
        }

      } catch (error: any) {
        console.error(chalk.red(`Failed to list tools: ${error.message}`));
        process.exit(1);
      }
    });
};
