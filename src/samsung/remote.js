// -----------------------------------------------------------------------------
// Remote-control WebSocket: wss://<ip>:8002/api/v2/channels/samsung.remote.control
//
// The authenticated channel. It carries key presses and app launches; volume
// LEVEL and mute go through UPnP instead (see upnp.js), which is deterministic
// and needs no pairing.
//
// Pairing: connecting without a token makes the TV display an authorization
// prompt ON ITS SCREEN. Once the user accepts, the TV sends back a token in its
// `ms.channel.connect` message, which we persist (tokenStore.js) so the prompt
// never comes back.
//
// The TV serves that endpoint with a SELF-SIGNED certificate, which is why this
// is the one place needing the `ws` package: the native WebSocket of Node has
// no way to accept it (`rejectUnauthorized` is not exposable).
// -----------------------------------------------------------------------------

import WebSocket from 'ws';
import { createLogger } from '@gladysassistant/integration-sdk';
import { getToken, saveToken } from './tokenStore.js';

const logger = createLogger({ name: 'samsung:remote' });

/** Name shown in the authorization prompt on the TV, and in its device list. */
const CLIENT_NAME = 'Gladys';

const CONNECT_TIMEOUT_MS = 10000;
/** Pairing needs a human to walk to the TV and press a button. */
const PAIRING_TIMEOUT_MS = 30000;
const APP_LIST_TIMEOUT_MS = 5000;

/** Open connections, one per TV id, shared by every command. */
const connections = new Map();

/**
 * Open an authenticated connection to a TV.
 * @param {object} tv - Target TV.
 * @param {string} tv.id - Stable id, used to store the token.
 * @param {string} tv.ip - IP address.
 * @returns {Promise<WebSocket>} The open socket.
 * @example
 * const socket = await openConnection({ id: 'uuid:...', ip: '192.168.1.29' });
 */
async function openConnection({ id, ip }) {
  const token = await getToken(id);
  const url =
    `wss://${ip}:8002/api/v2/channels/samsung.remote.control` +
    `?name=${Buffer.from(CLIENT_NAME).toString('base64')}` +
    (token ? `&token=${token}` : '');

  if (!token) {
    logger.info(`No pairing token for ${ip}: the TV will ask to authorize "${CLIENT_NAME}"`);
  }

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { rejectUnauthorized: false });
    const timer = setTimeout(
      () => {
        socket.terminate();
        reject(
          new Error(
            token
              ? `The TV at ${ip} did not answer`
              : `Authorization was not granted on the TV at ${ip} within 30 s`,
          ),
        );
      },
      token ? CONNECT_TIMEOUT_MS : PAIRING_TIMEOUT_MS,
    );

    socket.on('message', async (raw) => {
      const message = parseMessage(raw);
      // The TV is only usable once it says the channel is connected: opening
      // the socket alone proves nothing, the prompt may still be pending.
      if (message?.event === 'ms.channel.connect') {
        clearTimeout(timer);
        if (message.data?.token) {
          await saveToken(id, String(message.data.token));
        }
        resolve(socket);
      } else if (message?.event === 'ms.channel.unauthorized') {
        clearTimeout(timer);
        socket.close();
        reject(new Error(`The TV at ${ip} refused the connection (authorization denied)`));
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Connection to ${ip} failed: ${err.message}`));
    });
  });
}

/**
 * Parse an incoming frame, tolerating anything unexpected.
 * @param {Buffer|string} raw - Raw frame.
 * @returns {object|null} The parsed message, or null.
 * @example
 * const message = parseMessage(raw);
 */
function parseMessage(raw) {
  try {
    return JSON.parse(raw.toString());
  } catch {
    return null;
  }
}

/**
 * Get the shared connection to a TV, opening it on first use.
 * @param {object} tv - Target TV, `{ id, ip }`.
 * @returns {Promise<WebSocket>} The open socket.
 * @example
 * const socket = await getConnection(tv);
 */
async function getConnection(tv) {
  const existing = connections.get(tv.id);
  if (existing) {
    const socket = await existing;
    if (socket.readyState === WebSocket.OPEN) {
      return socket;
    }
    connections.delete(tv.id);
  }

  const pending = openConnection(tv).then((socket) => {
    // A TV going to sleep closes the socket: drop it so the next command
    // reconnects instead of writing into a dead one.
    socket.on('close', () => connections.delete(tv.id));
    socket.on('error', () => connections.delete(tv.id));
    return socket;
  });
  connections.set(tv.id, pending);

  try {
    return await pending;
  } catch (err) {
    connections.delete(tv.id);
    throw err;
  }
}

/**
 * Send a remote-control key to a TV.
 * @param {object} tv - Target TV, `{ id, ip }`.
 * @param {string} key - Key name, e.g. 'KEY_VOLUP'.
 * @returns {Promise<void>} Resolves once the frame is written.
 * @example
 * await sendKey(tv, 'KEY_VOLUP');
 */
export async function sendKey(tv, key) {
  const socket = await getConnection(tv);
  logger.debug(`${key} -> ${tv.ip}`);
  socket.send(
    JSON.stringify({
      method: 'ms.remote.control',
      params: {
        Cmd: 'Click',
        DataOfCmd: key,
        Option: 'false',
        TypeOfRemote: 'SendRemoteKey',
      },
    }),
  );
}

/**
 * Launch an installed application on a TV.
 * @param {object} tv - Target TV, `{ id, ip }`.
 * @param {string} appId - Application id.
 * @returns {Promise<void>} Resolves once the frame is written.
 * @example
 * await launchApp(tv, '11101200001');
 */
export async function launchApp(tv, appId) {
  const socket = await getConnection(tv);
  logger.debug(`launch app ${appId} -> ${tv.ip}`);
  socket.send(
    JSON.stringify({
      method: 'ms.channel.emit',
      params: {
        event: 'ed.apps.launch',
        to: 'host',
        data: { appId, action_type: 'DEEP_LINK' },
      },
    }),
  );
}

/**
 * Ask a TV for the applications it has installed.
 *
 * Best effort by design: several 2021+ models simply ignore the request (their
 * REST `/applications/` endpoint is gone too). An empty list is a normal
 * outcome, never a reason to fail discovery.
 * @param {object} tv - Target TV, `{ id, ip }`.
 * @returns {Promise<Array<{appId: string, name: string}>>} The installed apps, possibly empty.
 * @example
 * const apps = await listApps(tv);
 */
export async function listApps(tv) {
  let socket;
  try {
    socket = await getConnection(tv);
  } catch (err) {
    logger.debug(`App list unavailable on ${tv.ip}: ${err.message}`);
    return [];
  }

  return new Promise((resolve) => {
    const done = (apps) => {
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(apps);
    };
    const timer = setTimeout(() => {
      logger.debug(`The TV at ${tv.ip} ignored the app-list request`);
      done([]);
    }, APP_LIST_TIMEOUT_MS);

    const onMessage = (raw) => {
      const message = parseMessage(raw);
      if (message?.event === 'ed.installedApp.get') {
        const apps = (message.data?.data ?? [])
          .filter((app) => app.appId && app.name)
          .map((app) => ({ appId: String(app.appId), name: String(app.name) }));
        logger.info(`${apps.length} applications reported by ${tv.ip}`);
        done(apps);
      }
    };

    socket.on('message', onMessage);
    socket.send(
      JSON.stringify({
        method: 'ms.channel.emit',
        params: { event: 'ed.installedApp.get', to: 'host' },
      }),
    );
  });
}

/**
 * Close the connection to a TV, or to all of them.
 * @param {string} [tvId] - Id of the TV to disconnect; every TV when omitted.
 * @returns {void} Nothing.
 * @example
 * closeConnections();
 */
export function closeConnections(tvId) {
  const ids = tvId ? [tvId] : [...connections.keys()];
  for (const id of ids) {
    const pending = connections.get(id);
    connections.delete(id);
    pending?.then((socket) => socket.close()).catch(() => {});
  }
}
