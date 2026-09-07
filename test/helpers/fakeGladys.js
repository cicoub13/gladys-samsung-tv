// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the only surface this integration relies on, and records every
// call so the tests can assert on them, without a running Gladys server.
// -----------------------------------------------------------------------------

export function createFakeGladys({ scanResults = [] } = {}) {
  const published = [];
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
      published.push({ featureExternalId, state });
    },

    async publishStates(states) {
      for (const s of states) {
        published.push({ featureExternalId: s.device_feature_external_id, state: s.state });
      }
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
