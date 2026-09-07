// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user from the `config_schema` of the manifest; the SDK
// fetches it and notifies every change. This module only holds the defaults and
// normalizes what comes back, so the rest of the code never sees `undefined`.
// -----------------------------------------------------------------------------

/**
 * Refresh intervals Gladys accepts, in milliseconds: the core only schedules
 * polling on the values of its own DEVICE_POLL_FREQUENCIES list, so a value
 * outside it would be rejected at publication.
 */
export const POLL_FREQUENCIES = [10000, 15000, 30000, 60000];

export const DEFAULT_CONFIG = {
  poll_frequency: 30000,
};

/**
 * Merge the user configuration with the defaults.
 * @param {Record<string, unknown>} [raw] - Configuration returned by the SDK.
 * @returns {object} The normalized configuration.
 * @example
 * const config = normalizeConfig(await gladys.getConfig());
 */
export function normalizeConfig(raw = {}) {
  // A select comes back as a string when it travels through the form.
  const pollFrequency = Number(raw.poll_frequency);
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    poll_frequency: POLL_FREQUENCIES.includes(pollFrequency)
      ? pollFrequency
      : DEFAULT_CONFIG.poll_frequency,
  };
}
