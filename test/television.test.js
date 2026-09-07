import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDevice, readTarget, setValue, FEATURE, PARAM } from '../src/television.js';
import { parseSourceValue, appSourceValue } from '../src/samsung/keys.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const INFO = {
  id: 'uuid:261dc719-7a36-4104-ae2d-2c697882eea1',
  name: 'Samsung AU7025 55 TV',
  modelName: 'UE55AU7025KXXC',
  mac: 'B0:99:D7:BF:0C:AC',
  ip: '192.168.1.29',
  powerState: 'on',
};

const EXTERNAL_ID = `ext:samsung-tv:tv:${INFO.id}`;

/**
 * Build the device object Gladys sends back once the user created it.
 * @param {object} [overrides] - Params to override.
 * @returns {object} A created device.
 * @example
 * const device = createdDevice({ mac: '' });
 */
function createdDevice({ mac = INFO.mac } = {}) {
  return {
    external_id: EXTERNAL_ID,
    params: [
      { name: PARAM.IP, value: INFO.ip },
      { name: PARAM.MAC, value: mac },
      { name: PARAM.MODEL, value: INFO.modelName },
    ],
  };
}

test('buildDevice exposes the six features with a valid poll frequency', () => {
  const gladys = createFakeGladys();
  const device = buildDevice(gladys, INFO, normalizeConfig(), []);

  assert.equal(device.name, 'Samsung AU7025 55 TV');
  assert.equal(device.external_id, EXTERNAL_ID);
  // Gladys only schedules polling on the values of DEVICE_POLL_FREQUENCIES,
  // which are milliseconds: 300 (seconds) would silently never poll.
  assert.equal(device.poll_frequency, 30000);
  assert.deepEqual(
    device.features.map((f) => f.external_id.split(':').pop()),
    [
      FEATURE.POWER,
      FEATURE.VOLUME,
      FEATURE.VOLUME_UP,
      FEATURE.VOLUME_DOWN,
      FEATURE.MUTE,
      FEATURE.SOURCE,
    ],
  );

  const volume = device.features.find((f) => f.external_id.endsWith(FEATURE.VOLUME));
  assert.equal(volume.category, 'television');
  assert.equal(volume.type, 'volume');
  assert.equal(volume.unit, 'percent');
  assert.deepEqual([volume.min, volume.max], [0, 100]);
  assert.equal(volume.has_feedback, true);
});

test('every feature declares min and max, which the database requires', () => {
  // t_device_feature.min and .max are NOT NULL for every feature, with no
  // exception for the types where a range means nothing: omitting them makes
  // device creation fail with a 422 the user cannot do anything about.
  const device = buildDevice(createFakeGladys(), INFO, normalizeConfig(), []);
  for (const feature of device.features) {
    assert.equal(typeof feature.min, 'number', `${feature.name} has no min`);
    assert.equal(typeof feature.max, 'number', `${feature.name} has no max`);
  }
});

test('buildDevice carries the IP and MAC needed to reach the TV', () => {
  const device = buildDevice(createFakeGladys(), INFO, normalizeConfig(), []);
  assert.deepEqual(device.params, [
    { name: PARAM.IP, value: '192.168.1.29' },
    { name: PARAM.MAC, value: 'B0:99:D7:BF:0C:AC' },
    { name: PARAM.MODEL, value: 'UE55AU7025KXXC' },
  ]);
});

test('the source feature is a string select, extended by the installed apps', () => {
  const apps = [{ appId: '11101200001', name: 'Netflix' }];
  const device = buildDevice(createFakeGladys(), INFO, normalizeConfig(), apps);
  const source = device.features.find((f) => f.external_id.endsWith(FEATURE.SOURCE));

  // Only `text`/`select` accepts string option values, which is what keeps them
  // stable when an app is installed or removed.
  assert.equal(source.category, 'text');
  assert.equal(source.type, 'select');
  assert.deepEqual(source.supported_options, [
    { value: 'key:KEY_TV', label: 'TV', sort_order: 0 },
    { value: 'key:KEY_HDMI', label: 'HDMI', sort_order: 1 },
    { value: 'app:11101200001', label: 'Netflix', sort_order: 2 },
  ]);
});

test('a TV that reports no apps still offers its physical sources', () => {
  const device = buildDevice(createFakeGladys(), INFO, normalizeConfig(), []);
  const source = device.features.find((f) => f.external_id.endsWith(FEATURE.SOURCE));
  assert.equal(source.supported_options.length, 2);
});

test('readTarget recovers the TV id even though it contains colons', () => {
  assert.deepEqual(readTarget(createdDevice()), {
    id: 'uuid:261dc719-7a36-4104-ae2d-2c697882eea1',
    ip: '192.168.1.29',
    mac: 'B0:99:D7:BF:0C:AC',
  });
});

test('turning the TV on emits a magic packet and publishes nothing yet', async () => {
  const gladys = createFakeGladys();
  const feature = { external_id: `${EXTERNAL_ID}:${FEATURE.POWER}` };

  await setValue(gladys, { device: createdDevice(), feature, value: 1 });

  assert.deepEqual(gladys.wakeOnLanCalls, [{ mac: 'B0:99:D7:BF:0C:AC', options: undefined }]);
  // Wake-on-LAN is fire-and-forget: only the next poll knows whether the TV
  // actually woke up, so claiming success here would lie to the dashboard.
  assert.deepEqual(gladys.published, []);
});

test('turning on a TV with no known MAC fails with a readable message', async () => {
  const gladys = createFakeGladys();
  const feature = { external_id: `${EXTERNAL_ID}:${FEATURE.POWER}` };

  await assert.rejects(
    () => setValue(gladys, { device: createdDevice({ mac: '' }), feature, value: 1 }),
    /Wake-on-LAN is impossible/,
  );
});

test('an unknown feature is rejected instead of silently ignored', async () => {
  await assert.rejects(
    () =>
      setValue(createFakeGladys(), {
        device: createdDevice(),
        feature: { external_id: `${EXTERNAL_ID}:teleport` },
        value: 1,
      }),
    /Unknown feature/,
  );
});

test('source values say whether they are a key or an app', () => {
  assert.deepEqual(parseSourceValue('key:KEY_HDMI'), { kind: 'key', id: 'KEY_HDMI' });
  assert.deepEqual(parseSourceValue(appSourceValue('11101200001')), {
    kind: 'app',
    id: '11101200001',
  });
});
