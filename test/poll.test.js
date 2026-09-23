import test, { beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { pollDevice, setValue, forgetPublished, FEATURE, PARAM } from '../src/television.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const IP = '192.168.1.29';

// `fetch` is stubbed rather than served: the other test files already listen on
// 8001 and 9197, and the runner executes the files in parallel.
let tvPayload;
let calls;

const soapAnswer = (tag, value) =>
  `<s:Envelope><s:Body><${tag}>${value}</${tag}></s:Body></s:Envelope>`;

beforeEach(() => {
  calls = [];
  mock.method(globalThis, 'fetch', async (url, options = {}) => {
    calls.push(url);
    if (url.includes(':8001/')) {
      return new Response(JSON.stringify(tvPayload));
    }
    const action = options.headers?.SOAPACTION ?? '';
    if (action.includes('#GetVolume')) {
      return new Response(soapAnswer('CurrentVolume', 17));
    }
    if (action.includes('#GetMute')) {
      return new Response(soapAnswer('CurrentMute', 1));
    }
    return new Response('<ok/>');
  });
});

afterEach(() => {
  mock.restoreAll();
});

/**
 * A TV answering the REST endpoint with the given uuid and power state.
 * @param {string} id - UPnP uuid the TV reports.
 * @param {string} powerState - 'on' or 'standby'.
 * @returns {object} The REST payload.
 * @example
 * tvPayload = restPayload('uuid:a', 'on');
 */
function restPayload(id, powerState) {
  return { device: { id, name: 'TV', type: 'Samsung SmartTV', PowerState: powerState } };
}

/**
 * A created device, one uuid per test so the publication cache never leaks between them.
 * @param {string} id - UPnP uuid of the TV.
 * @returns {object} The device as Gladys sends it.
 * @example
 * const device = createdDevice('uuid:a');
 */
function createdDevice(id) {
  return {
    external_id: `ext:samsung-tv:tv:${id}`,
    params: [{ name: PARAM.IP, value: IP }],
  };
}

const feature = (device, key) => `${device.external_id}:${key}`;

test('a state Gladys refused is published again on the next poll', async () => {
  const device = createdDevice('uuid:refused');
  tvPayload = restPayload('uuid:refused', 'standby');
  const gladys = createFakeGladys({ publishFailures: 1 });

  await assert.rejects(() => pollDevice(gladys, device), /503/);
  await pollDevice(gladys, device);

  assert.deepEqual(gladys.published, [
    { featureExternalId: feature(device, FEATURE.POWER), state: 0 },
  ]);
});

test('a command feedback Gladys refused is published again on the next poll', async () => {
  const device = createdDevice('uuid:feedback');
  const gladys = createFakeGladys({ publishFailures: 1 });
  const mute = { external_id: feature(device, FEATURE.MUTE) };

  await assert.rejects(() => setValue(gladys, { device, feature: mute, value: 1 }), /503/);
  tvPayload = restPayload('uuid:feedback', 'on');
  await pollDevice(gladys, device);

  assert.ok(
    gladys.published.some(
      ({ featureExternalId, state }) => featureExternalId === mute.external_id && state === 1,
    ),
    'the mute state the TV reports reaches Gladys',
  );
});

test('a device created again gets its states published at once', async () => {
  const device = createdDevice('uuid:recreated');
  tvPayload = restPayload('uuid:recreated', 'standby');
  const gladys = createFakeGladys();

  await pollDevice(gladys, device);
  forgetPublished(device);
  await pollDevice(gladys, device);

  assert.equal(gladys.published.length, 2);
});

test('forgetting a device leaves the other devices alone', async () => {
  const kept = createdDevice('uuid:kept');
  const deleted = createdDevice('uuid:kept-2');
  const gladys = createFakeGladys();

  tvPayload = restPayload('uuid:kept', 'standby');
  await pollDevice(gladys, kept);
  forgetPublished(deleted);
  await pollDevice(gladys, kept);

  assert.equal(gladys.published.length, 1);
});

test('after a reconnection every state is published again', async () => {
  const device = createdDevice('uuid:reconnected');
  tvPayload = restPayload('uuid:reconnected', 'standby');
  const gladys = createFakeGladys();

  await pollDevice(gladys, device);
  forgetPublished();
  await pollDevice(gladys, device);

  assert.equal(gladys.published.length, 2);
});

test('another TV answering at the address counts as unreachable, with one warning', async () => {
  const device = createdDevice('uuid:living-room');
  // DHCP handed the living-room address to the bedroom TV.
  tvPayload = restPayload('uuid:bedroom', 'on');
  const gladys = createFakeGladys();
  const warnings = [];
  mock.method(console, 'error', (...args) => warnings.push(args.join(' ')));

  await pollDevice(gladys, device);
  await pollDevice(gladys, device);

  assert.deepEqual(gladys.published, [
    { featureExternalId: feature(device, FEATURE.POWER), state: 0 },
  ]);
  assert.ok(
    calls.every((url) => !url.includes(':9197')),
    'the volume of the other TV is not read',
  );
  const moved = warnings.filter((line) => line.includes('different device'));
  assert.equal(moved.length, 1, 'warned once, not on every poll');
  assert.ok(moved[0].includes(IP) && moved[0].includes('rescan'));
});

test('the warning comes back if the address changes hands again', async () => {
  const device = createdDevice('uuid:moving');
  const gladys = createFakeGladys();
  const warnings = [];
  mock.method(console, 'error', (...args) => warnings.push(args.join(' ')));

  tvPayload = restPayload('uuid:other', 'on');
  await pollDevice(gladys, device);
  tvPayload = restPayload('uuid:moving', 'standby');
  await pollDevice(gladys, device);
  tvPayload = restPayload('uuid:other', 'on');
  await pollDevice(gladys, device);

  assert.equal(warnings.filter((line) => line.includes('different device')).length, 2);
});
