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

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'samsung:token' });

const filePath = () => join(process.env.DATA_DIR ?? '/data', 'tokens.json');

/**
 * Read the whole token file.
 * @returns {Promise<Record<string, string>>} Tokens indexed by TV id, empty when there is no file yet.
 * @example
 * const tokens = await readTokens();
 */
async function readTokens() {
  try {
    return JSON.parse(await readFile(filePath(), 'utf8'));
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
export async function saveToken(tvId, token) {
  const tokens = await readTokens();
  if (tokens[tvId] === token) {
    return;
  }
  tokens[tvId] = token;
  try {
    await mkdir(dirname(filePath()), { recursive: true });
    await writeFile(filePath(), JSON.stringify(tokens, null, 2));
    logger.info(`Pairing token stored for ${tvId}`);
  } catch (err) {
    // Read-only /data would be a packaging bug, but a lost token only costs a
    // new prompt on the TV: keep running rather than fail the command.
    logger.error(`Could not store the pairing token: ${err.message}`);
  }
}
