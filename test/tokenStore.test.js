import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getToken, saveToken } from '../src/samsung/tokenStore.js';

let dataDir;
const tokenFile = () => join(dataDir, 'tokens.json');

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'samsung-tv-tokens-'));
  process.env.DATA_DIR = dataDir;
});

afterEach(async () => {
  delete process.env.DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

test('a stored token is read back', async () => {
  await saveToken('uuid:a', '11111111');

  assert.equal(await getToken('uuid:a'), '11111111');
  assert.equal(await getToken('uuid:unknown'), null);
});

test('the token file is readable by its owner only', async () => {
  await saveToken('uuid:a', '11111111');

  assert.equal((await stat(tokenFile())).mode & 0o777, 0o600);
});

test('two TVs paired at the same time both keep their token', async () => {
  // A scan pairs every TV it found in parallel.
  await Promise.all([saveToken('uuid:a', '11111111'), saveToken('uuid:b', '22222222')]);

  assert.deepEqual(JSON.parse(await readFile(tokenFile(), 'utf8')), {
    'uuid:a': '11111111',
    'uuid:b': '22222222',
  });
});

test('the token file is replaced, never rewritten in place', async () => {
  // Written before this fix: world-readable. A write in place would keep it
  // that way, and a crash halfway through would truncate it.
  await writeFile(tokenFile(), JSON.stringify({ 'uuid:a': '11111111' }));
  await chmod(tokenFile(), 0o400);

  await saveToken('uuid:b', '22222222');

  assert.equal(await getToken('uuid:a'), '11111111');
  assert.equal(await getToken('uuid:b'), '22222222');
  assert.equal((await stat(tokenFile())).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(dataDir), ['tokens.json'], 'no temporary file left behind');
});

test('a truncated token file reads as empty instead of failing', async () => {
  await writeFile(tokenFile(), '{"uuid:a": "1111');

  assert.equal(await getToken('uuid:a'), null);
});

test('a token file holding something else than an object reads as empty', async () => {
  await writeFile(tokenFile(), 'null');

  assert.equal(await getToken('uuid:a'), null);
});
