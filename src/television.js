// -----------------------------------------------------------------------------
// The television device: what Gladys shows, and what each command does.
//
// Three channels back the six features, each picked for what it does best:
//   - REST  (:8001) reads the power state, on every poll;
//   - UPnP  (:9197) reads AND writes the volume level and the mute state,
//     with no pairing and no ambiguity;
//   - WS    (:8002) sends the key presses, the only thing needing the token.
//
// Turning the TV ON is the exception: an off TV answers nothing at all, so the
// only way in is a Wake-on-LAN magic packet, emitted by the Gladys core.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { fetchDeviceInfo, isPoweredOn } from './samsung/rest.js';
import { getVolume, setVolume, getMute, setMute } from './samsung/upnp.js';
import { sendKey, launchApp, listApps, closeConnections } from './samsung/remote.js';
import { KEYS, STATIC_SOURCES, appSourceValue, parseSourceValue } from './samsung/keys.js';

const logger = createLogger({ name: 'television' });

const DEVICE_TYPE = 'tv';

export const FEATURE = {
  POWER: 'power',
  VOLUME: 'volume',
  VOLUME_UP: 'volume-up',
  VOLUME_DOWN: 'volume-down',
  MUTE: 'mute',
  SOURCE: 'source',
};

/** Device params, how a created device carries what it needs to be reached. */
export const PARAM = {
  IP: 'IP_ADDRESS',
  MAC: 'MAC_ADDRESS',
  MODEL: 'MODEL',
};

/**
 * Last value published per feature, to publish changes only: the host API
 * rate-limits states, and a TV that nobody touches would otherwise republish
 * the same three values forever.
 */
const lastPublished = new Map();

/**
 * Build the discovery payload of one TV.
 * @param {object} gladys - The SDK instance.
 * @param {object} info - Description read by `fetchDeviceInfo`.
 * @param {object} config - Normalized integration configuration.
 * @param {Array<{appId: string, name: string}>} [apps] - Installed apps, when the TV reported some.
 * @returns {object} The device, ready for `publishDiscoveredDevices`.
 * @example
 * const device = buildDevice(gladys, info, config, []);
 */
export function buildDevice(gladys, info, config, apps = []) {
  const ids = gladys.externalIds(DEVICE_TYPE, info.id);
  const sources = [
    ...STATIC_SOURCES,
    ...apps.map((app) => ({ value: appSourceValue(app.appId), label: app.name })),
  ];

  return {
    name: info.name,
    external_id: ids.device,
    poll_frequency: config.poll_frequency,
    params: [
      { name: PARAM.IP, value: info.ip },
      { name: PARAM.MAC, value: info.mac ?? '' },
      { name: PARAM.MODEL, value: info.modelName ?? '' },
    ],
    features: [
      {
        name: 'Power',
        external_id: ids.feature(FEATURE.POWER),
        category: DEVICE_FEATURE_CATEGORIES.TELEVISION,
        type: DEVICE_FEATURE_TYPES.TELEVISION.BINARY,
        min: 0,
        max: 1,
        read_only: false,
        has_feedback: true,
        keep_history: true,
      },
      {
        name: 'Volume',
        external_id: ids.feature(FEATURE.VOLUME),
        category: DEVICE_FEATURE_CATEGORIES.TELEVISION,
        type: DEVICE_FEATURE_TYPES.TELEVISION.VOLUME,
        unit: DEVICE_FEATURE_UNITS.PERCENT,
        min: 0,
        max: 100,
        read_only: false,
        has_feedback: true,
        keep_history: false,
      },
      {
        name: 'Volume up',
        external_id: ids.feature(FEATURE.VOLUME_UP),
        category: DEVICE_FEATURE_CATEGORIES.TELEVISION,
        type: DEVICE_FEATURE_TYPES.TELEVISION.VOLUME_UP,
        min: 0,
        max: 1,
        read_only: false,
        has_feedback: false,
        keep_history: false,
      },
      {
        name: 'Volume down',
        external_id: ids.feature(FEATURE.VOLUME_DOWN),
        category: DEVICE_FEATURE_CATEGORIES.TELEVISION,
        type: DEVICE_FEATURE_TYPES.TELEVISION.VOLUME_DOWN,
        min: 0,
        max: 1,
        read_only: false,
        has_feedback: false,
        keep_history: false,
      },
      {
        name: 'Mute',
        external_id: ids.feature(FEATURE.MUTE),
        category: DEVICE_FEATURE_CATEGORIES.TELEVISION,
        type: DEVICE_FEATURE_TYPES.TELEVISION.VOLUME_MUTE,
        min: 0,
        max: 1,
        read_only: false,
        has_feedback: true,
        keep_history: false,
      },
      {
        // A `text`/`select` rather than `television`/`source`: it is the only
        // type accepting STRING options, which is what keeps the values stable
        // when an app is installed or removed (an integer mapping would shift).
        // Gladys documents this exact case: "installed TV apps, HDMI sources".
        name: 'Source',
        external_id: ids.feature(FEATURE.SOURCE),
        category: DEVICE_FEATURE_CATEGORIES.TEXT,
        type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
        read_only: false,
        has_feedback: false,
        keep_history: false,
        supported_options: sources.map((source, index) => ({ ...source, sort_order: index })),
      },
    ],
  };
}

/**
 * Read the connection details a created device carries.
 * @param {object} device - Device as Gladys sends it (with its params).
 * @returns {{id: string, ip: string, mac: string|null}} What the protocol modules need.
 * @example
 * const tv = readTarget(device);
 */
export function readTarget(device) {
  const params = Object.fromEntries((device.params ?? []).map((p) => [p.name, p.value]));
  return {
    // The external_id ends with the TV id: `ext:<selector>:tv:<uuid>`.
    id: device.external_id.split(':').slice(3).join(':'),
    ip: params[PARAM.IP],
    mac: params[PARAM.MAC] || null,
  };
}

/**
 * Refresh the state of one TV.
 * @param {object} gladys - The SDK instance.
 * @param {object} device - Device to poll.
 * @returns {Promise<void>} Resolves once the changed states are published.
 * @example
 * await pollDevice(gladys, device);
 */
export async function pollDevice(gladys, device) {
  const tv = readTarget(device);
  const ids = gladys.externalIds(DEVICE_TYPE, tv.id);
  const info = await fetchDeviceInfo(tv.ip);
  const on = isPoweredOn(info);

  const states = [{ external_id: ids.feature(FEATURE.POWER), state: on ? 1 : 0 }];

  if (on) {
    // Only worth reading when the TV is awake: UPnP would just time out
    // otherwise, and slow every poll down for nothing.
    try {
      const [volume, muted] = await Promise.all([getVolume(tv.ip), getMute(tv.ip)]);
      states.push(
        { external_id: ids.feature(FEATURE.VOLUME), state: volume },
        { external_id: ids.feature(FEATURE.MUTE), state: muted ? 1 : 0 },
      );
    } catch (err) {
      logger.warn(`Could not read the volume of ${tv.ip}: ${err.message}`);
    }
  } else {
    // A sleeping TV drops the socket; make sure we do not keep a dead one.
    closeConnections(tv.id);
  }

  await publishChanges(gladys, states);
}

/**
 * Publish the states that actually changed since the last poll.
 * @param {object} gladys - The SDK instance.
 * @param {Array<{external_id: string, state: number}>} states - Freshly read states.
 * @returns {Promise<void>} Resolves once published.
 * @example
 * await publishChanges(gladys, states);
 */
async function publishChanges(gladys, states) {
  const changed = states.filter(({ external_id: id, state }) => lastPublished.get(id) !== state);
  if (changed.length === 0) {
    return;
  }
  changed.forEach(({ external_id: id, state }) => lastPublished.set(id, state));
  await gladys.publishStates(
    changed.map(({ external_id: id, state }) => ({ device_feature_external_id: id, state })),
  );
}

/**
 * Run a user command on a TV.
 * @param {object} gladys - The SDK instance.
 * @param {object} params - Command.
 * @param {object} params.device - Target device.
 * @param {object} params.feature - Actioned feature.
 * @param {number|string} params.value - Requested value.
 * @returns {Promise<void>} Resolves once the TV acknowledged.
 * @example
 * await setValue(gladys, { device, feature, value: 1 });
 */
export async function setValue(gladys, { device, feature, value }) {
  const tv = readTarget(device);
  const key = feature.external_id.split(':').pop();

  switch (key) {
    case FEATURE.POWER:
      return value === 1 ? powerOn(gladys, tv) : powerOff(gladys, tv, feature);
    case FEATURE.VOLUME:
      await setVolume(tv.ip, Number(value));
      return publishFeedback(gladys, feature, Number(value));
    case FEATURE.VOLUME_UP:
      return sendKey(tv, KEYS.VOLUME_UP);
    case FEATURE.VOLUME_DOWN:
      return sendKey(tv, KEYS.VOLUME_DOWN);
    case FEATURE.MUTE:
      await setMute(tv.ip, value === 1);
      return publishFeedback(gladys, feature, value === 1 ? 1 : 0);
    case FEATURE.SOURCE:
      return selectSource(tv, String(value));
    default:
      throw new Error(`Unknown feature: ${feature.external_id}`);
  }
}

/**
 * Wake a TV up with a magic packet.
 * @param {object} gladys - The SDK instance.
 * @param {object} tv - Target TV.
 * @returns {Promise<void>} Resolves once the packet is emitted.
 * @example
 * await powerOn(gladys, tv);
 */
async function powerOn(gladys, tv) {
  if (!tv.mac) {
    throw new Error('This TV reported no MAC address: Wake-on-LAN is impossible');
  }
  logger.info(`Wake-on-LAN -> ${tv.mac}`);
  await gladys.wakeOnLan(tv.mac);
  // Deliberately no state published here: the packet was emitted, which does
  // not mean the TV woke up. The next poll reports what actually happened.
}

/**
 * Turn a TV off.
 * @param {object} gladys - The SDK instance.
 * @param {object} tv - Target TV.
 * @param {object} feature - The power feature, to publish the feedback.
 * @returns {Promise<void>} Resolves once the key is sent.
 * @example
 * await powerOff(gladys, tv, feature);
 */
async function powerOff(gladys, tv, feature) {
  await sendKey(tv, KEYS.POWER);
  closeConnections(tv.id);
  await publishFeedback(gladys, feature, 0);
}

/**
 * Switch a TV to one of its declared sources.
 * @param {object} tv - Target TV.
 * @param {string} value - Option value, as declared in `supported_options`.
 * @returns {Promise<void>} Resolves once the command is sent.
 * @example
 * await selectSource(tv, 'key:KEY_HDMI');
 */
async function selectSource(tv, value) {
  const { kind, id } = parseSourceValue(value);
  return kind === 'key' ? sendKey(tv, id) : launchApp(tv, id);
}

/**
 * Publish the new value of a feature that has feedback, and remember it.
 * @param {object} gladys - The SDK instance.
 * @param {object} feature - The actioned feature.
 * @param {number} state - The value the TV now holds.
 * @returns {Promise<void>} Resolves once published.
 * @example
 * await publishFeedback(gladys, feature, 20);
 */
async function publishFeedback(gladys, feature, state) {
  lastPublished.set(feature.external_id, state);
  await gladys.publishState(feature.external_id, state);
}

/**
 * Read the applications installed on a TV, best effort.
 * @param {object} info - Description read by `fetchDeviceInfo`.
 * @returns {Promise<Array<{appId: string, name: string}>>} The apps, empty when the TV stays silent.
 * @example
 * const apps = await readApps(info);
 */
export async function readApps(info) {
  return listApps({ id: info.id, ip: info.ip });
}
