// -----------------------------------------------------------------------------
// Finding the TVs on the network.
//
// Integration containers sit on a bridge network, where SSDP never arrives, so
// the scan is mediated by the Gladys core (which runs on the host network):
// the core captures, we interpret. See `network_discovery` in the manifest.
//
// The search target we declare, RenderingControl, is generic on purpose: it is
// the only UPnP service recent Tizen TVs still announce (the Samsung-specific
// RemoteControlReceiver is gone from 2021 models). Speakers and set-top boxes
// answer it too, so the REST endpoint is what actually filters: only a Samsung
// TV answers :8001 with `type: "Samsung SmartTV"`.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { fetchDeviceInfo } from './samsung/rest.js';

const logger = createLogger({ name: 'discovery' });

const SCAN_TIMEOUT_SECONDS = 5;

/**
 * Scan the network and identify every Samsung TV that answers.
 * @param {object} gladys - The SDK instance.
 * @returns {Promise<Array<object>>} One description per TV found, with `mac` filled in when known.
 * @example
 * const televisions = await discoverTelevisions(gladys);
 */
export async function discoverTelevisions(gladys) {
  let results;
  try {
    results = await gladys.scanNetwork('ssdp', { timeoutSeconds: SCAN_TIMEOUT_SECONDS });
  } catch (err) {
    logger.error(`SSDP scan refused by the core: ${err.message}`);
    return [];
  }

  // One responder answers several times (once per announced service).
  const candidates = new Map();
  for (const { source_ip: ip, source_mac: mac } of results) {
    if (!candidates.has(ip)) {
      candidates.set(ip, mac ?? null);
    }
  }
  logger.info(`SSDP: ${results.length} answers, ${candidates.size} distinct hosts to identify`);

  const identified = await Promise.all(
    [...candidates].map(async ([ip, scanMac]) => {
      const info = await fetchDeviceInfo(ip);
      if (info === null) {
        return null;
      }
      // The TV reports its own MAC; the ARP-derived one from the scan is a
      // best-effort fallback (the core omits it when the kernel has no entry).
      return { ...info, mac: info.mac ?? scanMac };
    }),
  );

  const televisions = identified.filter((info) => info !== null);
  logger.info(`${televisions.length} Samsung TV(s) identified`);
  return televisions;
}
