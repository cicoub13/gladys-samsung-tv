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
