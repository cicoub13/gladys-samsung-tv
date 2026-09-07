import test, { before, after } from 'node:test';
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

const HOST = '127.0.0.1';

// ONE stub for the whole file, on the port the module targets (9197, as on
// every Samsung TV). Restarting a server on the same port between tests is
// what breaks: `fetch` keeps the connection of the previous one alive and
// reuses a socket nobody listens on any more.
let requests = [];
let respond = () => ({ status: 200, body: '<ok/>' });
let server;

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const action = req.headers.soapaction;
      requests.push({ url: req.url, action, body });
      const { status, body: answer } = respond({ action, body });
      res.writeHead(status, { 'Content-Type': 'text/xml' });
      res.end(answer);
    });
  });
  await new Promise((resolve) => server.listen(9197, HOST, resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('readNumber extracts the value out of a real answer', () => {
  assert.equal(internals.readNumber(VOLUME_ANSWER, 'CurrentVolume'), 17);
  assert.equal(internals.readNumber(MUTE_ANSWER, 'CurrentMute'), 1);
});

test('readNumber throws on an answer it cannot read', () => {
  assert.throws(() => internals.readNumber('<html>nope</html>', 'CurrentVolume'), /Unreadable/);
});

test('getVolume and getMute parse what the TV answers', async () => {
  requests = [];
  respond = ({ action }) => ({
    status: 200,
    body: action.includes('GetVolume') ? VOLUME_ANSWER : MUTE_ANSWER,
  });

  assert.equal(await getVolume(HOST), 17);
  assert.equal(await getMute(HOST), true);
});

test('setVolume clamps out-of-range values and sends a well-formed action', async () => {
  requests = [];
  respond = () => ({ status: 200, body: '<ok/>' });

  await setVolume(HOST, 142);
  await setVolume(HOST, -8);
  await setMute(HOST, true);

  assert.equal(requests[0].url, '/upnp/control/RenderingControl1');
  assert.equal(requests[0].action, '"urn:schemas-upnp-org:service:RenderingControl:1#SetVolume"');
  assert.match(requests[0].body, /<DesiredVolume>100<\/DesiredVolume>/);
  assert.match(requests[1].body, /<DesiredVolume>0<\/DesiredVolume>/);
  assert.match(requests[2].body, /<DesiredMute>1<\/DesiredMute>/);
});

test('a UPnP fault surfaces its reason', async () => {
  requests = [];
  respond = () => ({
    status: 500,
    body: '<errorDescription>Invalid Action</errorDescription>',
  });

  await assert.rejects(() => getVolume(HOST), /Invalid Action/);
});
