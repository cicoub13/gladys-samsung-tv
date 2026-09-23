// -----------------------------------------------------------------------------
// Persistence of the pairing tokens.
//
// The TV hands out a token the first time it is paired, after the user accepts
// the prompt ON THE SCREEN. Losing that token means asking them to accept it
// again on every restart, so it has to survive the container: /data is the only
// writable location of the sandbox.
//
// DATA_DIR overrides the location, which is what makes running the integration
// straight from a dev machine possible (no /data there).
// -----------------------------------------------------------------------------

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'samsung:token' });

const filePath = () => join(process.env.DATA_DIR ?? '/data', 'tokens.json');

/** Tail of the write queue: writes run one after the other, never interleaved. */
let writing = Promise.resolve();

/**
 * Read the whole token file.
 * @returns {Promise<Record<string, string>>} Tokens indexed by TV id, empty when there is no file yet.
 * @example
 * const tokens = await readTokens();
 */
async function readTokens() {
  try {
    const tokens = JSON.parse(await readFile(filePath(), 'utf8'));
    if (tokens === null || typeof tokens !== 'object' || Array.isArray(tokens)) {
      throw new Error('not a JSON object');
    }
    return tokens;
  } catch (err) {
    // No file yet (first run) or unreadable content: start from scratch rather
    // than crash. The worst case is one extra prompt on the TV.
    if (err.code !== 'ENOENT') {
      logger.warn(`Unreadable token file, starting empty: ${err.message}`);
    }
    return {};
  }
}

/**
 * Read the token of one TV.
 * @param {string} tvId - Stable id of the TV.
 * @returns {Promise<string|null>} The stored token, or null.
 * @example
 * const token = await getToken('uuid:261dc719-...');
 */
export async function getToken(tvId) {
  return (await readTokens())[tvId] ?? null;
}

/**
 * Store the token of one TV.
 * @param {string} tvId - Stable id of the TV.
 * @param {string} token - Token handed out by the TV.
 * @returns {Promise<void>} Resolves once written.
 * @example
 * await saveToken('uuid:261dc719-...', '12345678');
 */
export function saveToken(tvId, token) {
  // Queued: two TVs paired during the same scan would otherwise both read the
  // file before either writes it, and one of the tokens would be lost.
  writing = writing.then(() => writeToken(tvId, token));
  return writing;
}

/**
 * Store the token of one TV, atomically.
 * @param {string} tvId - Stable id of the TV.
 * @param {string} token - Token handed out by the TV.
 * @returns {Promise<void>} Resolves once written; never rejects.
 * @example
 * await writeToken('uuid:261dc719-...', '12345678');
 */
async function writeToken(tvId, token) {
  const tokens = await readTokens();
  if (tokens[tvId] === token) {
    return;
  }
  tokens[tvId] = token;
  const file = filePath();
  const temporaryFile = `${file}.tmp`;
  try {
    await mkdir(dirname(file), { recursive: true });
    // Temporary file then rename, atomic on the same filesystem: a power cut
    // can never leave a truncated file, which would lose EVERY TV's token. The
    // token drives the TV remote: readable by its owner only.
    await writeFile(temporaryFile, JSON.stringify(tokens, null, 2), { mode: 0o600 });
    await rename(temporaryFile, file);
    logger.info(`Pairing token stored for ${tvId}`);
  } catch (err) {
    // Read-only /data would be a packaging bug, but a lost token only costs a
    // new prompt on the TV: keep running rather than fail the command.
    logger.error(`Could not store the pairing token: ${err.message}`);
  }
}
