// -----------------------------------------------------------------------------
// Entry point of the Samsung Smart TV integration.
//
// This file only wires the SDK to the television module: it holds no protocol
// logic. Its three jobs are to instantiate the SDK, register the handlers
// BEFORE connecting, and connect.
//
// The environment variables (GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN,
// GLADYS_INTEGRATION_SELECTOR) are read by the SDK on its own.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { discoverTelevisions } from './src/discovery.js';
import {
  buildDevice,
  pollTelevisions,
  setValue,
  readTarget,
  readApps,
  forgetPublished,
} from './src/television.js';
import { Poller } from './src/poller.js';
import { fetchDeviceInfo, isPoweredOn } from './src/samsung/rest.js';
import { getVolume } from './src/samsung/upnp.js';
import { closeConnections } from './src/samsung/remote.js';

const gladys = new GladysIntegration();

let config = normalizeConfig();

// --- Polling: the integration reads its TVs back on its own timer ------------
// Not through gladys.onPoll: Gladys only polls devices created with
// `should_poll: true`, which the TVs already created do not carry.
const poller = new Poller({
  run: () => pollTelevisions(gladys),
  interval: () => config.poll_frequency,
});

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> scanning the network');
  const televisions = await discoverTelevisions(gladys);
  const devices = await Promise.all(
    televisions.map(async (info) => buildDevice(gladys, info, await readApps(info))),
  );
  await gladys.publishDiscoveredDevices(devices);
});

// --- Command: the user actioned a feature ------------------------------------
gladys.onSetValue(async (device, feature, value) => {
  logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
  await setValue(gladys, { device, feature, value });
});

// --- Polling: a no-op, src/poller.js refreshes the TVs ----------------------
// TVs created before the own timer still carry a poll_frequency. Should a
// Gladys version start polling them, ack instead of answering "not implemented".
gladys.onPoll(() => {});

// --- A device disappeared: drop what we held for it --------------------------
gladys.onDeviceDeleted(async (device) => {
  closeConnections(readTarget(device).id);
  // A device created again under the same external_id must get its states.
  forgetPublished(device);
});

// --- Manifest action: the "Test the connection" button -----------------------
gladys.onAction('test_connection', async (fields) => {
  const device = gladys.devices.find((d) => d.external_id === fields.device);
  if (!device) {
    throw new Error('Unknown device, refresh the page');
  }
  const tv = readTarget(device);
  const info = await fetchDeviceInfo(tv.ip);
  if (!isPoweredOn(info)) {
    return {
      en: `No answer from ${tv.ip}: the TV is off or unreachable.`,
      fr: `Aucune réponse de ${tv.ip} : la TV est éteinte ou injoignable.`,
    };
  }
  const volume = await getVolume(tv.ip);
  return {
    en: `${info.modelName} reachable at ${tv.ip}, powered on, volume ${volume}%.`,
    fr: `${info.modelName} joignable sur ${tv.ip}, allumée, volume ${volume} %.`,
  };
});

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  config = normalizeConfig(newConfig);
  poller.rearm();
});

// --- Connection lifecycle ----------------------------------------------------
gladys.on('connected', async () => {
  // Publications may have failed while Gladys was away: republish everything.
  forgetPublished();
  try {
    config = normalizeConfig(await gladys.getConfig());
    await gladys.setConnectionStatus(true);
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
      })
      .catch(() => {});
  }
  // Not awaited: the first run reads every TV, the handler need not wait for it.
  poller.start();
});

gladys.on('disconnected', () => {
  poller.stop();
  closeConnections();
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  poller.stop();
  closeConnections();
});

// --- Safety net --------------------------------------------------------------
// A rejection nobody handles means the process state is unknown: log why, then
// exit and let the Gladys supervisor restart the integration from scratch.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection, exiting:', reason);
  process.exit(1);
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Samsung Smart TV integration...');
// A token refused at boot can be transient (Gladys still starting): the SDK
// keeps reconnecting for life, so exiting here would only stop the retries.
gladys.connect().catch((err) => {
  logger.error(`Initial connection failed: ${err.message} (retrying in the background)`);
});
