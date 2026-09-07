import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { discoverTelevisions } from '../src/discovery.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const TV_PAYLOAD = {
  device: {
    PowerState: 'on',
    id: 'uuid:261dc719-7a36-4104-ae2d-2c697882eea1',
    modelName: 'UE55AU7025KXXC',
    name: 'Samsung AU7025 55 TV',
    type: 'Samsung SmartTV',
    wifiMac: 'B0:99:D7:BF:0C:AC',
  },
};

/**
 * Serve the Samsung REST endpoint on 127.0.0.1:8001 for one payload.
 * @param {object|null} payload - What :8001 answers, or null to answer 404.
 * @returns {Promise<{close: Function}>} The running stub.
 * @example
 * const stub = await startRestStub(TV_PAYLOAD);
 */
async function startRestStub(payload) {
  const server = createServer((req, res) => {
    if (payload === null) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(8001, '127.0.0.1', resolve));
  return { close: () => new Promise((resolve) => server.close(resolve)) };
}

test('a Samsung TV answering the REST endpoint is identified', async () => {
  const stub = await startRestStub(TV_PAYLOAD);
  const gladys = createFakeGladys({
    scanResults: [{ source_ip: '127.0.0.1', source_mac: 'aa:bb:cc:dd:ee:ff', headers: '' }],
  });
  try {
    const found = await discoverTelevisions(gladys);
    assert.equal(found.length, 1);
    assert.equal(found[0].id, 'uuid:261dc719-7a36-4104-ae2d-2c697882eea1');
    // The TV's own MAC wins over the ARP-derived one from the scan.
    assert.equal(found[0].mac, 'B0:99:D7:BF:0C:AC');
  } finally {
    await stub.close();
  }
});

test('the same host answering several services is identified once', async () => {
  const stub = await startRestStub(TV_PAYLOAD);
  const gladys = createFakeGladys({
    scanResults: [
      { source_ip: '127.0.0.1', headers: 'RenderingControl' },
      { source_ip: '127.0.0.1', headers: 'AVTransport' },
      { source_ip: '127.0.0.1', headers: 'ConnectionManager' },
    ],
  });
  try {
    assert.equal((await discoverTelevisions(gladys)).length, 1);
  } finally {
    await stub.close();
  }
});

test('anything that is not a Samsung TV is filtered out', async () => {
  // The declared search target is generic (RenderingControl), so speakers and
  // set-top boxes answer it too: the REST endpoint is the real filter.
  const stub = await startRestStub(null);
  const gladys = createFakeGladys({ scanResults: [{ source_ip: '127.0.0.1', headers: '' }] });
  try {
    assert.deepEqual(await discoverTelevisions(gladys), []);
  } finally {
    await stub.close();
  }
});

test('a scan refused by the core degrades to an empty list', async () => {
  const gladys = createFakeGladys();
  mock.method(gladys, 'scanNetwork', () => Promise.reject(new Error('403 forbidden')));
  assert.deepEqual(await discoverTelevisions(gladys), []);
});
