import { spawnSync } from 'node:child_process';

/**
 * Builds the e2e client (with test fixtures) once, before any worker starts its own server for it
 * (see `localServer` in fixtures.ts).
 */
export default function globalSetup(): void {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const build = spawnSync(npm, ['run', 'build:e2e'], { stdio: 'inherit', shell: true });
  if (build.status !== 0) throw new Error(`npm run build:e2e failed (exit ${build.status}).`);
}
