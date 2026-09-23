import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

// index.js wires the process itself (connect, exit), so it is exercised as a
// real child process against a stub of the Gladys WebSocket.

const ENTRY = fileURLToPath(new URL('../index.js', import.meta.url));

const servers = [];

after(() => {
  for (const server of servers) {
    server.close();
  }
});

/**
 * Start a stub Gladys WebSocket.
 * @param {(socket: object) => void} onConnection - What the stub does with each client.
 * @returns {Promise<string>} The host API URL to hand to the integration.
 * @example
 * const url = await stubGladys((socket) => socket.close(4000));
 */
async function stubGladys(onConnection) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  servers.push(server);
  server.on('connection', onConnection);
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

/**
 * Start index.js against a stub Gladys.
 * @param {string} hostApiUrl - URL of the stub.
 * @param {Array<string>} [nodeArgs] - Extra node flags.
 * @returns {object} The child, with its output accumulated in `child.output`.
 * @example
 * const child = startIntegration(url);
 */
function startIntegration(hostApiUrl, nodeArgs = []) {
  const child = spawn(process.execPath, [...nodeArgs, ENTRY], {
    env: {
      ...process.env,
      GLADYS_HOST_API_URL: hostApiUrl,
      GLADYS_INTEGRATION_TOKEN: 'test-token',
      GLADYS_INTEGRATION_SELECTOR: 'samsung-tv',
      LOG_LEVEL: 'info',
    },
  });
  child.output = '';
  child.stdout.on('data', (chunk) => (child.output += chunk));
  child.stderr.on('data', (chunk) => (child.output += chunk));
  return child;
}

/**
 * Wait until the child printed a pattern, or fail after a deadline.
 * @param {object} child - Child from `startIntegration`.
 * @param {RegExp} pattern - What to wait for.
 * @returns {Promise<void>} Resolves once printed.
 * @example
 * await waitForOutput(child, /Initial connection failed/);
 */
async function waitForOutput(child, pattern) {
  const deadline = Date.now() + 5000;
  while (!pattern.test(child.output)) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${pattern}; output:\n${child.output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test('a token refused at boot is logged, and the process stays up to retry', async () => {
  // Gladys closes with 4000 for any token error, including transient ones
  // while it boots: the SDK keeps retrying, so the process must not exit.
  const url = await stubGladys((socket) => socket.close(4000));
  const child = startIntegration(url);
  try {
    await waitForOutput(child, /Initial connection failed/);
    assert.match(child.output, /\[ERROR\].*Initial connection failed.*authentication refused/);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.equal(child.exitCode, null, `the process exited; output:\n${child.output}`);
  } finally {
    child.kill('SIGKILL');
  }
});
