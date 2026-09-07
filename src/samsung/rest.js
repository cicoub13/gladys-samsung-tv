// -----------------------------------------------------------------------------
// Samsung REST endpoint: http://<ip>:8001/api/v2/
//
// The unauthenticated endpoint every Tizen TV exposes. Two jobs here:
//   1. IDENTIFY a device found on the network (is it really a Samsung TV?);
//   2. PROBE its power state, which is how we know whether it is on or off.
//
// A TV that is off simply stops answering (connection refused or timeout), so
// "no answer" is a legitimate state, not an error: every failure resolves to
// null and the caller reads that as "off / unreachable".
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'samsung:rest' });

const DEFAULT_TIMEOUT_MS = 2000;

/** The `type` a Samsung TV reports: our filter against anything else on the LAN. */
export const SAMSUNG_TV_TYPE = 'Samsung SmartTV';

/**
 * Read the device description of a TV.
 * @param {string} ip - IP address of the TV.
 * @param {object} [options] - Options.
 * @param {number} [options.timeoutMs] - Abort delay in milliseconds.
 * @returns {Promise<object|null>} The normalized description, or null when the TV does not answer.
 * @example
 * const info = await fetchDeviceInfo('192.168.1.29');
 */
export async function fetchDeviceInfo(ip, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  try {
    const response = await fetch(`http://${ip}:8001/api/v2/`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return null;
    }
    return normalizeDeviceInfo(await response.json(), ip);
  } catch (err) {
    // Offline TV, wrong host, non-Samsung device answering on 8001: all the
    // same to us. Debug level only, this runs on every poll.
    logger.debug(`No answer from ${ip}: ${err.message}`);
    return null;
  }
}

/**
 * Normalize the raw payload of the REST endpoint.
 * @param {object} payload - Raw JSON returned by the TV.
 * @param {string} ip - IP the payload was read from.
 * @returns {object|null} Normalized description, or null when it is not a Samsung TV.
 * @example
 * const info = normalizeDeviceInfo(payload, '192.168.1.29');
 */
export function normalizeDeviceInfo(payload, ip) {
  const device = payload?.device;
  if (!device || device.type !== SAMSUNG_TV_TYPE) {
    return null;
  }
  return {
    // `id` is the stable UPnP uuid of the TV: our platform id, immune to DHCP.
    id: device.id ?? payload.id,
    name: device.name ?? payload.name,
    modelName: device.modelName,
    mac: device.wifiMac ?? null,
    ip,
    // Older models do not report PowerState at all. Answering the REST call is
    // then the only signal we have, and it means the TV is awake.
    powerState: device.PowerState ?? 'on',
    tokenAuthSupport: device.TokenAuthSupport === 'true',
  };
}

/**
 * Whether a description read by `fetchDeviceInfo` means "the TV is on".
 * @param {object|null} info - Description returned by `fetchDeviceInfo`.
 * @returns {boolean} True when the TV is on.
 * @example
 * const on = isPoweredOn(await fetchDeviceInfo('192.168.1.29'));
 */
export function isPoweredOn(info) {
  return info !== null && info.powerState === 'on';
}
