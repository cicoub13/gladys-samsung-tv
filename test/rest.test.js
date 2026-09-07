import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDeviceInfo, isPoweredOn } from '../src/samsung/rest.js';

// Captured verbatim from a real UE55AU7025KXXC.
const REAL_PAYLOAD = {
  device: {
    PowerState: 'on',
    TokenAuthSupport: 'true',
    id: 'uuid:261dc719-7a36-4104-ae2d-2c697882eea1',
    modelName: 'UE55AU7025KXXC',
    name: 'Samsung AU7025 55 TV',
    type: 'Samsung SmartTV',
    wifiMac: 'B0:99:D7:BF:0C:AC',
  },
  id: 'uuid:261dc719-7a36-4104-ae2d-2c697882eea1',
  name: 'Samsung AU7025 55 TV',
};

test('normalizeDeviceInfo reads a real TV payload', () => {
  const info = normalizeDeviceInfo(REAL_PAYLOAD, '192.168.1.29');
  assert.deepEqual(info, {
    id: 'uuid:261dc719-7a36-4104-ae2d-2c697882eea1',
    name: 'Samsung AU7025 55 TV',
    modelName: 'UE55AU7025KXXC',
    mac: 'B0:99:D7:BF:0C:AC',
    ip: '192.168.1.29',
    powerState: 'on',
    tokenAuthSupport: true,
  });
});

test('normalizeDeviceInfo rejects anything that is not a Samsung TV', () => {
  const speaker = { device: { type: 'Sonos', name: 'Kitchen' } };
  assert.equal(normalizeDeviceInfo(speaker, '192.168.1.30'), null);
  assert.equal(normalizeDeviceInfo({}, '192.168.1.30'), null);
  assert.equal(normalizeDeviceInfo(null, '192.168.1.30'), null);
});

test('normalizeDeviceInfo assumes "on" when the model reports no PowerState', () => {
  const payload = { device: { ...REAL_PAYLOAD.device } };
  delete payload.device.PowerState;
  assert.equal(normalizeDeviceInfo(payload, '192.168.1.29').powerState, 'on');
});

test('isPoweredOn tells standby and unreachable apart from on', () => {
  assert.equal(isPoweredOn(normalizeDeviceInfo(REAL_PAYLOAD, '192.168.1.29')), true);
  assert.equal(isPoweredOn({ powerState: 'standby' }), false);
  assert.equal(isPoweredOn(null), false);
});
