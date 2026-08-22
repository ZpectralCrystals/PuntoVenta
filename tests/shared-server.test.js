import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(url) {
  const expires = Date.now() + 5000;
  while (Date.now() < expires) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Servidor compartido no inició a tiempo');
}

test('comparte y persiste estado POS mediante SQLite', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'mesa-clara-test-'));
  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', POS_DB_PATH: join(directory, 'test.sqlite') },
    stdio: 'ignore',
  });

  t.after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  });

  const health = await waitForHealth(url);
  assert.equal(health.database, 'sqlite');

  const login = await fetch(`${url}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  }).then((response) => response.json());
  const auth = { Authorization: `Bearer ${login.token}` };
  const before = await fetch(`${url}/api/state`, { headers: auth }).then((response) => response.json());
  assert.equal(before.state.users.some((user) => 'password' in user), false);
  const changed = structuredClone(before.state);
  changed.settings.businessName = 'Festival compartido QA';
  const saved = await fetch(`${url}/api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ state: changed, expectedRevision: before.revision }),
  }).then((response) => response.json());
  const after = await fetch(`${url}/api/state`, { headers: auth }).then((response) => response.json());

  assert.equal(saved.revision, before.revision + 1);
  assert.equal(after.state.settings.businessName, 'Festival compartido QA');
  assert.equal(after.revision, saved.revision);
});
