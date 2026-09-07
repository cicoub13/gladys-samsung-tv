// -----------------------------------------------------------------------------
// UPnP RenderingControl: http://<ip>:9197/upnp/control/RenderingControl1
//
// The TV exposes a standard MediaRenderer, and its RenderingControl service
// answers WITHOUT any authentication. That is what makes absolute volume and
// mute possible at all: the remote-control WebSocket only carries key presses
// (VOL+ / VOL- / MUTE toggle), so it can neither set a level nor read one back.
//
// Four SOAP actions are all we need, so there is no UPnP library here: a SOAP
// call is one POST and one regular expression on the answer.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'samsung:upnp' });

const SERVICE = 'urn:schemas-upnp-org:service:RenderingControl:1';
const DEFAULT_TIMEOUT_MS = 3000;

/**
 * Run one RenderingControl SOAP action.
 * @param {string} ip - IP address of the TV.
 * @param {string} action - SOAP action name, e.g. 'GetVolume'.
 * @param {Record<string, string|number>} args - Action arguments, in declaration order.
 * @param {object} [options] - Options.
 * @param {number} [options.timeoutMs] - Abort delay in milliseconds.
 * @returns {Promise<string>} The raw XML body of the answer.
 * @example
 * const xml = await callRenderingControl('192.168.1.29', 'GetVolume', { InstanceID: 0, Channel: 'Master' });
 */
async function callRenderingControl(ip, action, args, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const body =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>` +
    `<u:${action} xmlns:u="${SERVICE}">` +
    Object.entries(args)
      .map(([name, value]) => `<${name}>${value}</${name}>`)
      .join('') +
    `</u:${action}></s:Body></s:Envelope>`;

  const response = await fetch(`http://${ip}:9197/upnp/control/RenderingControl1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      SOAPACTION: `"${SERVICE}#${action}"`,
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    // A UPnP fault comes back as a 500 with the reason in the body.
    throw new Error(`${action} failed (HTTP ${response.status}): ${extractFaultReason(text)}`);
  }
  return text;
}

/**
 * Extract the readable reason of a UPnP fault, for the error message.
 * @param {string} xml - Raw fault body.
 * @returns {string} The reason, or a truncated body when the shape is unknown.
 * @example
 * const reason = extractFaultReason('<errorDescription>Invalid Action</errorDescription>');
 */
function extractFaultReason(xml) {
  return xml.match(/<errorDescription>([^<]*)<\/errorDescription>/)?.[1] ?? xml.slice(0, 200);
}

/**
 * Read a numeric field out of a SOAP answer.
 * @param {string} xml - Raw XML answer.
 * @param {string} tag - Tag to read, e.g. 'CurrentVolume'.
 * @returns {number} The parsed value.
 * @example
 * const volume = readNumber(xml, 'CurrentVolume');
 */
function readNumber(xml, tag) {
  const raw = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1];
  const value = Number(raw);
  if (raw === undefined || Number.isNaN(value)) {
    throw new Error(`Unreadable answer: no <${tag}> in ${xml.slice(0, 200)}`);
  }
  return value;
}

/**
 * Read the current volume of the TV.
 * @param {string} ip - IP address of the TV.
 * @returns {Promise<number>} Volume between 0 and 100.
 * @example
 * const volume = await getVolume('192.168.1.29');
 */
export async function getVolume(ip) {
  const xml = await callRenderingControl(ip, 'GetVolume', { InstanceID: 0, Channel: 'Master' });
  return readNumber(xml, 'CurrentVolume');
}

/**
 * Set the volume of the TV.
 * @param {string} ip - IP address of the TV.
 * @param {number} volume - Target volume, clamped to 0-100.
 * @returns {Promise<void>} Resolves once the TV acknowledged.
 * @example
 * await setVolume('192.168.1.29', 20);
 */
export async function setVolume(ip, volume) {
  const target = Math.round(Math.min(100, Math.max(0, volume)));
  logger.debug(`SetVolume ${target} on ${ip}`);
  await callRenderingControl(ip, 'SetVolume', {
    InstanceID: 0,
    Channel: 'Master',
    DesiredVolume: target,
  });
}

/**
 * Read the mute state of the TV.
 * @param {string} ip - IP address of the TV.
 * @returns {Promise<boolean>} True when muted.
 * @example
 * const muted = await getMute('192.168.1.29');
 */
export async function getMute(ip) {
  const xml = await callRenderingControl(ip, 'GetMute', { InstanceID: 0, Channel: 'Master' });
  return readNumber(xml, 'CurrentMute') === 1;
}

/**
 * Set the mute state of the TV.
 * @param {string} ip - IP address of the TV.
 * @param {boolean} muted - Target state.
 * @returns {Promise<void>} Resolves once the TV acknowledged.
 * @example
 * await setMute('192.168.1.29', true);
 */
export async function setMute(ip, muted) {
  logger.debug(`SetMute ${muted} on ${ip}`);
  await callRenderingControl(ip, 'SetMute', {
    InstanceID: 0,
    Channel: 'Master',
    DesiredMute: muted ? 1 : 0,
  });
}

export const internals = { readNumber, extractFaultReason };
