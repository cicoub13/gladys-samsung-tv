// -----------------------------------------------------------------------------
// Remote-control keys and input sources.
//
// The key names are the ones the Samsung remote protocol understands; only the
// handful the integration actually sends is listed, not the full catalog.
// -----------------------------------------------------------------------------

export const KEYS = {
  POWER: 'KEY_POWER',
  VOLUME_UP: 'KEY_VOLUP',
  VOLUME_DOWN: 'KEY_VOLDOWN',
  TV: 'KEY_TV',
  HDMI: 'KEY_HDMI',
};

/**
 * Input sources every Tizen TV reaches through a remote key, whatever its
 * model. Installed apps are added on top of these at discovery time, when the
 * TV answers the app-list request.
 *
 * The values are the option values of the `text`/`select` feature, so they are
 * sent back to us verbatim by `onSetValue`: the `key:` prefix is how we tell a
 * remote key from an application id at command time.
 */
export const STATIC_SOURCES = [
  { value: `key:${KEYS.TV}`, label: 'TV' },
  { value: `key:${KEYS.HDMI}`, label: 'HDMI' },
];

/** Prefix marking a source implemented as a remote key rather than an app launch. */
export const KEY_SOURCE_PREFIX = 'key:';

/**
 * Build the option value of an installed application.
 * @param {string} appId - Application id reported by the TV.
 * @returns {string} The option value to declare in `supported_options`.
 * @example
 * const value = appSourceValue('11101200001');
 */
export function appSourceValue(appId) {
  return `app:${appId}`;
}

/**
 * Read back what a source option value means.
 * @param {string} value - Option value received from Gladys.
 * @returns {{kind: 'key'|'app', id: string}} The command to run.
 * @example
 * const { kind, id } = parseSourceValue('key:KEY_HDMI');
 */
export function parseSourceValue(value) {
  return value.startsWith(KEY_SOURCE_PREFIX)
    ? { kind: 'key', id: value.slice(KEY_SOURCE_PREFIX.length) }
    : { kind: 'app', id: value.slice('app:'.length) };
}
