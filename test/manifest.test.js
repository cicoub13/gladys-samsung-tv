import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { POLL_FREQUENCIES, DEFAULT_CONFIG, normalizeConfig } from '../src/config.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url)),
);

test('the manifest declares the accesses the integration actually uses', () => {
  assert.equal(manifest.type, 'device');
  assert.deepEqual(manifest.categories, ['multimedia']);
  // Wake-on-LAN and the SSDP capture are enforced server-side: an undeclared
  // access is a 403, and the user sees both on the install screen.
  assert.equal(manifest.network_wake, true);
  assert.deepEqual(manifest.network_discovery, [
    { type: 'ssdp', st: 'urn:schemas-upnp-org:service:RenderingControl:1' },
  ]);
});

test('a single SSDP capture is declared, since the core only scans the first', () => {
  assert.equal(manifest.network_discovery.length, 1);
});

test('the cover image is served from this repository', () => {
  assert.match(manifest.cover_image, /^https:\/\/raw\.githubusercontent\.com\/.+\/cover\.png$/);
});

test('the cover image meets what the store indexer requires', async () => {
  const cover = await readFile(new URL('../cover.png', import.meta.url));

  // The indexer wants a PNG or JPEG of exactly 800x534, 150 KB max: an invalid
  // cover is not a rejection, it is silently replaced by a placeholder, so the
  // only way to notice a bad one is to check it here.
  assert.ok(
    cover.length <= 150 * 1024,
    `cover.png is ${cover.length} bytes, over the 150 KB limit`,
  );
  assert.deepEqual([...cover.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // Width and height are big-endian 32-bit integers in the IHDR chunk.
  assert.equal(cover.readUInt32BE(16), 800);
  assert.equal(cover.readUInt32BE(20), 534);
});

test('the refresh options match the frequencies Gladys can schedule', () => {
  const field = manifest.config_schema.find((f) => f.key === 'poll_frequency');
  assert.deepEqual(
    field.options.map((o) => Number(o.value)),
    POLL_FREQUENCIES,
  );
  assert.equal(Number(field.default), DEFAULT_CONFIG.poll_frequency);
});

test('a select value coming back as a string is normalized to a number', () => {
  assert.equal(normalizeConfig({ poll_frequency: '15000' }).poll_frequency, 15000);
});

test('a frequency Gladys cannot schedule falls back to the default', () => {
  assert.equal(normalizeConfig({ poll_frequency: 300 }).poll_frequency, 30000);
  assert.equal(normalizeConfig({ poll_frequency: 'nope' }).poll_frequency, 30000);
  assert.equal(normalizeConfig().poll_frequency, 30000);
});

test('every action handled in index.js is declared in the manifest', () => {
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    ['test_connection'],
  );
});
