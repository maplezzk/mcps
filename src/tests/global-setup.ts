import { execFileSync } from 'node:child_process';

export default function setup() {
  // Subprocess integration tests must exercise freshly compiled CLI code.
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc'], { stdio: 'inherit' });
}
