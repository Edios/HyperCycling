import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import open from 'open';
import { serverConfig } from '../src/server/config';

const url = `http://${serverConfig.host}:${serverConfig.port}`;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// STATIC_DIR points the server at an externally built client (used by the e2e run, which builds
// its own copy with test fixtures); without it the normal dist/client build is used and kept fresh.
const externalStaticDir = process.env.STATIC_DIR;
const staticDir = externalStaticDir ?? 'dist/client';
const builtIndex = `${staticDir}/index.html`;

function newestMtime(path: string): number {
  if (!existsSync(path)) return 0;
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  return readdirSync(path).reduce((m, f) => Math.max(m, newestMtime(join(path, f))), 0);
}

/** True when the built client is missing or older than any of its sources. */
function needsBuild(): boolean {
  if (!existsSync(builtIndex)) return true;
  const built = statSync(builtIndex).mtimeMs;
  const sources = ['src', 'public', 'index.html', 'vite.config.ts', 'package.json'];
  return sources.some((p) => newestMtime(p) > built);
}

if (!externalStaticDir && needsBuild()) {
  console.log('Building app…');
  const build = spawnSync(npm, ['run', 'build'], { stdio: 'inherit', shell: true });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const server = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts'], {
  stdio: 'inherit',
  env: { ...process.env, STATIC_DIR: staticDir },
});
server.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => server.kill());

// Wait until the server answers (up to ~10 s), then open the browser.
let healthy = false;
for (let i = 0; i < 100 && !healthy; i++) {
  try {
    healthy = (await fetch(`${url}/api/health`)).ok;
  } catch {
    // server not listening yet
  }
  if (!healthy) await new Promise((r) => setTimeout(r, 100));
}
if (!healthy) {
  console.error(`Server did not become healthy at ${url} within 10 s.`);
  server.kill();
  process.exit(1);
}
console.log(`Spinning Tutor running at ${url}`);
if (process.env.NO_OPEN !== '1') await open(url);
