import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import open from 'open';

const url = 'http://127.0.0.1:5175';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (!existsSync('dist/client/index.html')) {
  const build = spawnSync(npm, ['run', 'build'], { stdio: 'inherit', shell: true });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const server = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts'], {
  stdio: 'inherit',
  env: { ...process.env, STATIC_DIR: 'dist/client' },
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
