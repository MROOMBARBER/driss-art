import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const directory = fileURLToPath(new URL('../', import.meta.url));
const origin = 'http://127.0.0.1:5173';
let server;
let tests;
let stopping;

async function stopChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise(resolve => child.once('close', resolve));
  child.kill('SIGTERM');
  const timeout = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, 5_000);
  timeout.unref();
  await closed;
  clearTimeout(timeout);
}

function stop() {
  // Only processes created by this runner are stopped; never kill by port/name.
  stopping ??= (async () => { await stopChild(tests); await stopChild(server); })();
  return stopping;
}

for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, async () => { process.exitCode = code; await stop(); });
}

try {
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Run through npm run test:e2e so both Firebase emulators are available.');
  }
  // An occupied port is an error, not permission to reuse/stop someone’s server.
  const portCheck = createServer();
  await new Promise((resolve, reject) => {
    portCheck.once('error', reject);
    portCheck.listen(5173, '127.0.0.1', resolve);
  });
  await new Promise(resolve => portCheck.close(resolve));

  server = spawn(process.execPath, [
    'node_modules/vite/bin/vite.js', '--mode', 'emulator', '--host', '127.0.0.1',
    '--port', '5173', '--strictPort',
  ], { cwd: directory, stdio: ['ignore', 'inherit', 'inherit'] });
  let startupError;
  server.once('error', error => { startupError = error; });
  const deadline = Date.now() + 40_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (startupError) throw startupError;
    if (server.exitCode !== null || server.signalCode !== null) throw new Error('Vite exited before startup.');
    try {
      const response = await fetch(`${origin}/connexion`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok && (await response.text()).includes('/src/main.tsx')) { ready = true; break; }
    } catch { /* Vite may still be binding its port. */ }
    await delay(200);
  }
  if (!ready) throw new Error('Vite did not serve the portal within 40 seconds.');
  if (stopping) throw new Error('E2E runner was interrupted.');

  tests = spawn(process.execPath, ['--test', 'tests/portal.e2e.mjs'], {
    cwd: directory,
    env: { ...process.env, PORTAL_E2E_ORIGIN: origin },
    stdio: 'inherit',
  });
  const code = await new Promise((resolve, reject) => {
    tests.once('error', reject);
    tests.once('close', (exitCode, signal) => resolve(exitCode ?? (signal === 'SIGINT' ? 130 : 1)));
  });
  process.exitCode ??= code;
} catch (error) {
  console.error(error.message);
  process.exitCode ??= 1;
} finally {
  await stop();
}
