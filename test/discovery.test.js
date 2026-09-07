import test, { before, after, mock } from 'node:test';
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

// ONE stub for the whole file, on the port the module targets (8001). What it
// answers is swapped per test: restarting a server on the same port between
// tests would leave `fetch` reusing the keep-alive socket of the previous one.
let payload = TV_PAYLOAD;
let server;

before(async () => {
  server = createServer((req, res) => {
    if (payload === null) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(8001, '127.0.0.1', resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('a Samsung TV answering the REST endpoint is identified', async () => {
  payload = TV_PAYLOAD;
  const gladys = createFakeGladys({
    scanResults: [{ source_ip: '127.0.0.1', source_mac: 'aa:bb:cc:dd:ee:ff', headers: '' }],
  });

  const found = await discoverTelevisions(gladys);
  assert.equal(found.length, 1);
  assert.equal(found[0].id, 'uuid:261dc719-7a36-4104-ae2d-2c697882eea1');
  // The TV's own MAC wins over the ARP-derived one from the scan.
  assert.equal(found[0].mac, 'B0:99:D7:BF:0C:AC');
});

test('the same host answering several services is identified once', async () => {
  payload = TV_PAYLOAD;
  const gladys = createFakeGladys({
    scanResults: [
      { source_ip: '127.0.0.1', headers: 'RenderingControl' },
      { source_ip: '127.0.0.1', headers: 'AVTransport' },
      { source_ip: '127.0.0.1', headers: 'ConnectionManager' },
    ],
  });

  assert.equal((await discoverTelevisions(gladys)).length, 1);
});

test('anything that is not a Samsung TV is filtered out', async () => {
  // The declared search target is generic (RenderingControl), so speakers and
  // set-top boxes answer it too: the REST endpoint is the real filter.
  payload = null;
  const gladys = createFakeGladys({ scanResults: [{ source_ip: '127.0.0.1', headers: '' }] });

  assert.deepEqual(await discoverTelevisions(gladys), []);
});

test('a scan refused by the core degrades to an empty list', async () => {
  const gladys = createFakeGladys();
  mock.method(gladys, 'scanNetwork', () => Promise.reject(new Error('403 forbidden')));

  assert.deepEqual(await discoverTelevisions(gladys), []);
});
