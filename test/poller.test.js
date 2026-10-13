import test, { beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Poller } from '../src/poller.js';
import { pollTelevisions, FEATURE, PARAM } from '../src/television.js';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';

// `fetch` is stubbed (the other test files listen on 8001 and 9197) and every
// TV is in standby: only the REST endpoint is read, once per TV and per poll.
let restCalls;

beforeEach(() => {
  restCalls = [];
  mock.method(globalThis, 'fetch', async (url) => {
    const ip = new URL(url).hostname;
    restCalls.push(ip);
    const id = `uuid:${ip}`;
    return new Response(
      JSON.stringify({
        device: { id, name: 'TV', type: 'Samsung SmartTV', PowerState: 'standby' },
      }),
    );
  });
});

afterEach(() => {
  mock.restoreAll();
});

/**
 * A created TV, its uuid derived from its IP so the stub answers as itself.
 * @param {string} ip - IP of the TV.
 * @returns {object} The device as Gladys sends it.
 * @example
 * const device = createdDevice('10.0.0.1');
 */
function createdDevice(ip) {
  return {
    name: `TV ${ip}`,
    external_id: `ext:samsung-tv:tv:uuid:${ip}`,
    params: [{ name: PARAM.IP, value: ip }],
  };
}

const polls = (ip) => restCalls.filter((called) => called === ip).length;

const fakeGladys = () => createFakeGladys({ selector: 'samsung-tv' });

const publishedIds = (gladys) =>
  gladys.fake.states.map(({ device_feature_external_id: id }) => id).sort();

/**
 * Let the runs a fired timer started settle (timers are mocked, setImmediate is not).
 * @returns {Promise<void>} Resolves a few event-loop turns later.
 * @example
 * await settle();
 */
async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * A run whose end the test decides, counting how many run at once.
 * @returns {object} `run` for the Poller, `finish()` to end the oldest run.
 * @example
 * const runs = controlledRuns();
 */
function controlledRuns() {
  const pending = [];
  const state = { started: 0, active: 0, maxActive: 0 };
  return {
    state,
    run() {
      state.started += 1;
      state.active += 1;
      state.maxActive = Math.max(state.maxActive, state.active);
      return new Promise((resolve) => pending.push(resolve)).finally(() => {
        state.active -= 1;
      });
    },
    finish() {
      pending.shift()();
    },
  };
}

test('every created TV is polled at once, then at each interval', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const gladys = fakeGladys();
  gladys.devices = [createdDevice('10.0.0.1'), createdDevice('10.0.0.2')];
  const poller = new Poller({ run: () => pollTelevisions(gladys), interval: () => 30000 });

  await poller.start();
  assert.deepEqual([polls('10.0.0.1'), polls('10.0.0.2')], [1, 1]);
  assert.deepEqual(publishedIds(gladys), [
    `ext:samsung-tv:tv:uuid:10.0.0.1:${FEATURE.POWER}`,
    `ext:samsung-tv:tv:uuid:10.0.0.2:${FEATURE.POWER}`,
  ]);

  t.mock.timers.tick(29999);
  await settle();
  assert.deepEqual([polls('10.0.0.1'), polls('10.0.0.2')], [1, 1], 'not before the interval');

  t.mock.timers.tick(1);
  await settle();
  assert.deepEqual([polls('10.0.0.1'), polls('10.0.0.2')], [2, 2]);

  // A TV created meanwhile is picked up by the next run.
  gladys.devices = [...gladys.devices, createdDevice('10.0.0.3')];
  t.mock.timers.tick(30000);
  await settle();
  assert.deepEqual([polls('10.0.0.1'), polls('10.0.0.2'), polls('10.0.0.3')], [3, 3, 1]);
  poller.stop();
});

test('a configuration change re-arms the timer at the new interval', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let interval = 30000;
  let runs = 0;
  const poller = new Poller({ run: async () => (runs += 1), interval: () => interval });

  await poller.start();
  interval = 10000;
  poller.rearm();

  t.mock.timers.tick(10000);
  await settle();
  assert.equal(runs, 2, 'polled after the new interval, not the old one');

  t.mock.timers.tick(10000);
  await settle();
  assert.equal(runs, 3);
  poller.stop();
});

test('a run outlasting the interval is never overlapped', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const runs = controlledRuns();
  const poller = new Poller({ run: runs.run, interval: () => 10000 });

  const started = poller.start();
  t.mock.timers.tick(60000);
  poller.rearm();
  t.mock.timers.tick(60000);
  await settle();
  assert.equal(runs.state.started, 1, 'no second run while the first is in flight');

  runs.finish();
  await started;
  t.mock.timers.tick(10000);
  await settle();
  assert.equal(runs.state.started, 2, 'the next run starts an interval after the first settled');
  assert.equal(runs.state.maxActive, 1);
  runs.finish();
  await settle();
  poller.stop();
});

test('a TV that fails does not stop the others nor the loop', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  mock.method(console, 'error', () => {});
  // The first publication is refused: one of the two TVs fails its first poll.
  const gladys = fakeGladys();
  t.mock.method(gladys, 'publishStates').mock.mockImplementationOnce(async () => {
    throw new Error('503 Service Unavailable');
  });
  gladys.devices = [createdDevice('10.0.1.1'), createdDevice('10.0.1.2')];
  const poller = new Poller({ run: () => pollTelevisions(gladys), interval: () => 30000 });

  await poller.start();
  assert.equal(gladys.fake.states.length, 1, 'the other TV got its state');

  t.mock.timers.tick(30000);
  await settle();
  assert.deepEqual(
    publishedIds(gladys),
    [
      `ext:samsung-tv:tv:uuid:10.0.1.1:${FEATURE.POWER}`,
      `ext:samsung-tv:tv:uuid:10.0.1.2:${FEATURE.POWER}`,
    ],
    'the failed TV is published on the next run',
  );
  poller.stop();
});

test('a run that throws still schedules the next one', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  mock.method(console, 'error', () => {});
  let runs = 0;
  const poller = new Poller({
    run: async () => {
      runs += 1;
      throw new Error('boom');
    },
    interval: () => 10000,
  });

  await poller.start();
  t.mock.timers.tick(10000);
  await settle();
  assert.equal(runs, 2);
  poller.stop();
});

test('stop cancels the next run, and a run in flight schedules nothing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const runs = controlledRuns();
  const poller = new Poller({ run: runs.run, interval: () => 10000 });

  const started = poller.start();
  poller.stop();
  runs.finish();
  await started;
  t.mock.timers.tick(60000);
  await settle();
  assert.equal(runs.state.started, 1);

  // Started again (reconnection), then stopped while waiting for the timer.
  await Promise.all([poller.start(), runs.finish()]);
  poller.stop();
  t.mock.timers.tick(60000);
  await settle();
  assert.equal(runs.state.started, 2);
});

test('a reconnection never starts a second loop', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const runs = controlledRuns();
  const poller = new Poller({ run: runs.run, interval: () => 10000 });

  // Disconnected while a run is in flight, reconnected before it settled.
  const started = poller.start();
  poller.stop();
  // Not awaited: a doubled run would never settle, the assertion catches it.
  poller.start();
  poller.start();
  await settle();
  assert.equal(runs.state.started, 1, 'the run in flight is not doubled');

  runs.finish();
  await started;
  t.mock.timers.tick(10000);
  await settle();
  assert.equal(runs.state.started, 2, 'the loop goes on once, from the run in flight');
  assert.equal(runs.state.maxActive, 1);
  runs.finish();
  await settle();
  poller.stop();
});
