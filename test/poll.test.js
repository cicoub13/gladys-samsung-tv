import test, { beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { pollDevice, setValue, FEATURE, PARAM } from '../src/television.js';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';

const IP = '192.168.1.29';

// `fetch` is stubbed rather than served: the other test files already listen on
// 8001 and 9197, and the runner executes the files in parallel.
let tvPayload;
let calls;
// When set, the TV holds its volume answer until this promise settles.
let volumeAnswered;

const soapAnswer = (tag, value) =>
  `<s:Envelope><s:Body><${tag}>${value}</${tag}></s:Body></s:Envelope>`;

beforeEach(() => {
  calls = [];
  volumeAnswered = null;
  mock.method(globalThis, 'fetch', async (url, options = {}) => {
    calls.push(url);
    if (url.includes(':8001/')) {
      return new Response(JSON.stringify(tvPayload));
    }
    const action = options.headers?.SOAPACTION ?? '';
    if (action.includes('#GetVolume')) {
      await volumeAnswered;
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
 * A created device, one uuid per test so the module-level feedback record never leaks between them.
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

const fakeGladys = () => createFakeGladys({ selector: 'samsung-tv' });

/**
 * A fake Gladys whose host API refuses the next publication (Gladys restarting, 429...).
 * @param {object} t - The test context, whose mocks are restored at its end.
 * @returns {object} The fake Gladys.
 * @example
 * const gladys = refusingGladys(t);
 */
function refusingGladys(t) {
  const gladys = fakeGladys();
  t.mock.method(gladys, 'publishStates').mock.mockImplementationOnce(async () => {
    throw new Error('503 Service Unavailable');
  });
  return gladys;
}

test('a state Gladys refused is published again on the next poll', async (t) => {
  const device = createdDevice('uuid:refused');
  tvPayload = restPayload('uuid:refused', 'standby');
  const gladys = refusingGladys(t);

  await assert.rejects(() => pollDevice(gladys, device), /503/);
  await pollDevice(gladys, device);

  assert.deepEqual(gladys.fake.states, [
    { device_feature_external_id: feature(device, FEATURE.POWER), state: 0 },
  ]);
});

test('a command feedback Gladys refused is published again on the next poll', async (t) => {
  const device = createdDevice('uuid:feedback');
  const gladys = refusingGladys(t);
  const mute = { external_id: feature(device, FEATURE.MUTE) };

  await assert.rejects(() => setValue(gladys, { device, feature: mute, value: 1 }), /503/);
  tvPayload = restPayload('uuid:feedback', 'on');
  await pollDevice(gladys, device);

  assert.equal(
    gladys.fake.lastState(mute.external_id),
    1,
    'the mute state the TV reports reaches Gladys',
  );
});

test('another TV answering at the address counts as unreachable, with one warning', async () => {
  const device = createdDevice('uuid:living-room');
  // DHCP handed the living-room address to the bedroom TV.
  tvPayload = restPayload('uuid:bedroom', 'on');
  const gladys = fakeGladys();
  const warnings = [];
  mock.method(console, 'error', (...args) => warnings.push(args.join(' ')));

  await pollDevice(gladys, device);
  await pollDevice(gladys, device);

  assert.deepEqual(gladys.fake.states, [
    { device_feature_external_id: feature(device, FEATURE.POWER), state: 0 },
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
  const gladys = fakeGladys();
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

test('a poll that read the TV before a command does not undo its feedback', async () => {
  const device = createdDevice('uuid:race');
  tvPayload = restPayload('uuid:race', 'on');
  const gladys = fakeGladys();
  const volume = { external_id: feature(device, FEATURE.VOLUME) };
  let answerVolume;
  volumeAnswered = new Promise((resolve) => (answerVolume = resolve));

  // The poll asks the volume (17) just before the user sets it to 40...
  const polling = pollDevice(gladys, device);
  while (!calls.some((url) => url.includes(':9197'))) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  await setValue(gladys, { device, feature: volume, value: 40 });
  // ...and only gets the old answer once the command went through.
  answerVolume();
  await polling;

  assert.deepEqual(
    gladys.fake.states.filter(({ device_feature_external_id: id }) => id === volume.external_id),
    [{ device_feature_external_id: volume.external_id, state: 40 }],
  );

  // The next poll is not affected: it reports what the TV says.
  await pollDevice(gladys, device);
  assert.deepEqual(gladys.fake.states.at(-1), {
    device_feature_external_id: volume.external_id,
    state: 17,
  });
});
