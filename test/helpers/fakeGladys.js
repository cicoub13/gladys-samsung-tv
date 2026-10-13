// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the only surface this integration relies on, and records every
// call so the tests can assert on them, without a running Gladys server.
// -----------------------------------------------------------------------------

export function createFakeGladys({ scanResults = [], publishFailures = 0 } = {}) {
  const published = [];
  // The host API refusing a publication (Gladys restarting, 429...): the next
  // `publishFailures` calls throw, the following ones succeed.
  let failuresLeft = publishFailures;
  const refusePublish = () => {
    if (failuresLeft > 0) {
      failuresLeft -= 1;
      throw new Error('503 Service Unavailable');
    }
  };
  const lastPublished = new Map();
  const discovered = [];
  const wakeOnLanCalls = [];
  const connectionStatuses = [];

  return {
    published,
    discovered,
    wakeOnLanCalls,
    connectionStatuses,
    scanResults,

    externalIds(type, platformId) {
      const device = `ext:samsung-tv:${type}:${platformId}`;
      return {
        device,
        feature: (key) => `${device}:${key}`,
      };
    },

    async publishState(featureExternalId, state) {
      refusePublish();
      published.push({ featureExternalId, state });
    },

    async publishStates(states) {
      refusePublish();
      for (const s of states) {
        published.push({ featureExternalId: s.device_feature_external_id, state: s.state });
      }
    },

    // The SDK contract: only changed values are sent, remembered once accepted.
    async publishChangedStates(states) {
      const changed = states.filter(
        ({ device_feature_external_id: id, state }) => lastPublished.get(id) !== state,
      );
      if (changed.length > 0) {
        await this.publishStates(changed);
        changed.forEach(({ device_feature_external_id: id, state }) =>
          lastPublished.set(id, state),
        );
      }
      return { success: true, count: changed.length };
    },

    async publishDiscoveredDevices(devices) {
      discovered.push(...devices);
    },

    async scanNetwork() {
      return this.scanResults;
    },

    async wakeOnLan(mac, options) {
      wakeOnLanCalls.push({ mac, options });
      return { success: true };
    },

    async setConnectionStatus(connected, message) {
      connectionStatuses.push({ connected, message });
    },
  };
}
