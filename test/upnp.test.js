import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { getVolume, setVolume, getMute, setMute, internals } from '../src/samsung/upnp.js';

// Answers captured verbatim from a real UE55AU7025KXXC.
const VOLUME_ANSWER =
  '<?xml version="1.0" encoding="utf-8"?><s:Envelope s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" ' +
  'xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:GetVolumeResponse ' +
  'xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><CurrentVolume>17</CurrentVolume>\n' +
  '</u:GetVolumeResponse></s:Body></s:Envelope>';

const MUTE_ANSWER = VOLUME_ANSWER.replaceAll('Volume', 'Mute').replace('>17<', '>1<');

test('readNumber extracts the value out of a real answer', () => {
  assert.equal(internals.readNumber(VOLUME_ANSWER, 'CurrentVolume'), 17);
  assert.equal(internals.readNumber(MUTE_ANSWER, 'CurrentMute'), 1);
});

test('readNumber throws on an answer it cannot read', () => {
  assert.throws(() => internals.readNumber('<html>nope</html>', 'CurrentVolume'), /Unreadable/);
});

/**
 * Start a stub RenderingControl endpoint on 127.0.0.1.
 * @param {Function} handler - Receives `{ action, body }`, returns `{ status, body }`.
 * @returns {Promise<{host: string, requests: Array, close: Function}>} The running stub.
 * @example
 * const stub = await startStub(() => ({ status: 200, body: VOLUME_ANSWER }));
 */
async function startStub(handler) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const action = req.headers.soapaction;
      requests.push({ url: req.url, action, body });
      const { status, body: answer } = handler({ action, body });
      res.writeHead(status, { 'Content-Type': 'text/xml' });
      res.end(answer);
    });
  });
  // Port 9197 is hardcoded in the module, as it is on every Samsung TV.
  await new Promise((resolve) => server.listen(9197, '127.0.0.1', resolve));
  return {
    host: '127.0.0.1',
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('getVolume and getMute parse what the TV answers', async () => {
  const stub = await startStub(({ action }) => ({
    status: 200,
    body: action.includes('GetVolume') ? VOLUME_ANSWER : MUTE_ANSWER,
  }));
  try {
    assert.equal(await getVolume(stub.host), 17);
    assert.equal(await getMute(stub.host), true);
  } finally {
    await stub.close();
  }
});

test('setVolume clamps out-of-range values and sends a well-formed action', async () => {
  const stub = await startStub(() => ({ status: 200, body: '<ok/>' }));
  try {
    await setVolume(stub.host, 142);
    await setVolume(stub.host, -8);
    await setMute(stub.host, true);
  } finally {
    await stub.close();
  }

  assert.equal(stub.requests[0].url, '/upnp/control/RenderingControl1');
  assert.equal(
    stub.requests[0].action,
    '"urn:schemas-upnp-org:service:RenderingControl:1#SetVolume"',
  );
  assert.match(stub.requests[0].body, /<DesiredVolume>100<\/DesiredVolume>/);
  assert.match(stub.requests[1].body, /<DesiredVolume>0<\/DesiredVolume>/);
  assert.match(stub.requests[2].body, /<DesiredMute>1<\/DesiredMute>/);
});

test('a UPnP fault surfaces its reason', async () => {
  const stub = await startStub(() => ({
    status: 500,
    body: '<errorDescription>Invalid Action</errorDescription>',
  }));
  try {
    await assert.rejects(() => getVolume(stub.host), /Invalid Action/);
  } finally {
    await stub.close();
  }
});
