import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';

const origin = 'https://betterworldsoftware.github.io';
const base = 'https://origami-crane-frames.example.workers.dev';
const bytes = new TextEncoder().encode('gzip bytes');
const model = {model: 'crane', steps: [{index: 0, folder: 'step-01', name: 'Fold'}]};
const manifest = {index: 0, vertexCount: 3, bakedFrames: 10,
  chunks: [{file: 'frames-0.bin.gz', first: 0, frames: 10, bytes: bytes.length}]};

function environment() {
  const objects = new Map([
    ['crane/model.json', JSON.stringify(model)],
    ['crane/step-01/manifest.json', JSON.stringify(manifest)],
    ['crane/step-01/index.bin.gz', bytes],
    ['crane/step-01/uv.bin.gz', bytes],
    ['crane/step-01/frames-0.bin.gz', bytes]
  ]);
  return {SITE_ORIGIN: origin, TOKEN_SECRET: 'test-secret-'.repeat(4),
    BAKE: {async get(key) {
      const value = objects.get(key);
      if (value === undefined) return null;
      return {body: new Blob([value]).stream(),
        async json() {return JSON.parse(value);}};
    }}};
}

function request(path, {method = 'GET', from = origin, token} = {}) {
  const headers = {'Origin': from};
  if (token) headers.Authorization = 'Bearer ' + token;
  return new Request(base + path, {method, headers});
}

test('only the configured site can request a session', async () => {
  const env = environment();
  const denied = await worker.fetch(request('/api/session',
    {method: 'POST', from: 'https://other.example'}), env);
  assert.equal(denied.status, 403);
  const session = await worker.fetch(request('/api/session', {method: 'POST'}), env);
  assert.equal(session.status, 200);
  assert.equal(session.headers.get('Access-Control-Allow-Origin'), origin);
  const data = await session.json();
  assert.match(data.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.ok(data.expiresAt > Date.now() / 1000);
});

test('model and step manifest require a token and give expiring file links', async () => {
  const env = environment();
  assert.equal((await worker.fetch(request('/api/models/crane'), env)).status, 401);
  const {token} = await (await worker.fetch(request('/api/session',
    {method: 'POST'}), env)).json();
  const response = await worker.fetch(request('/api/models/crane', {token}), env);
  assert.deepEqual(await response.json(), model);
  const step = await worker.fetch(request('/api/models/crane/steps/1', {token}), env);
  assert.equal(step.status, 200);
  const data = await step.json();
  assert.equal(data.expiresIn, 300);
  assert.equal(data.chunks.length, 1);
  assert.match(data.index, /\/files\/crane\/step-01\/index\.bin\.gz\?exp=/);
  const fileUrl = new URL(data.chunks[0].url);
  const file = await worker.fetch(request(fileUrl.pathname + fileUrl.search), env);
  assert.equal(file.status, 200);
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
  const altered = new URL(data.index);
  altered.searchParams.set('exp', String(Number(altered.searchParams.get('exp')) + 1));
  assert.equal((await worker.fetch(request(altered.pathname + altered.search), env)).status, 403);
});

test('unlisted routes and unsafe file paths cannot read R2', async () => {
  const env = environment();
  const {token} = await (await worker.fetch(request('/api/session',
    {method: 'POST'}), env)).json();
  assert.equal((await worker.fetch(request('/api/models/crane/steps/2', {token}), env)).status, 404);
  assert.equal((await worker.fetch(request('/api/models/private', {token}), env)).status, 404);
  assert.equal((await worker.fetch(request('/files/other/secret.bin.gz', {token}), env)).status, 404);
  assert.equal((await worker.fetch(request('/files/crane/../secret.bin.gz', {token}), env)).status, 404);
});
