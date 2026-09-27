# AGENTS.md: gladys-samsung-tv

Project-specific notes. Generic rules (SDK contract, commands, kit-owned files, runtime) are in `CLAUDE.md`;
the protocol overview table is in `README.md`.

## Architecture (`src/`)

- `index.js`: wiring only (no protocol logic). Handlers: scan, setValue, poll, deviceDeleted, `test_connection`
  action, configUpdated, `connected`/`disconnected`, shutdown, `unhandledRejection` (log then `exit(1)`).
- `src/config.js`: `normalizeConfig()`; only real key is `poll_frequency`. The manifest select sends it as a
  **string**; it is coerced to a number and must be in `POLL_FREQUENCIES` (`10000/15000/30000/60000`, the
  core's `DEVICE_POLL_FREQUENCIES`), else falls back to `30000`.
- `src/discovery.js`: `gladys.scanNetwork('ssdp', 5 s)` → dedupe by `source_ip` → `fetchDeviceInfo(ip)` filters
  real TVs. MAC: TV's own `wifiMac` first, ARP `source_mac` from the scan as fallback. A refused scan returns `[]`.
- `src/television.js`: device model (`buildDevice`), `pollDevice`, `setValue`, publish cache. Dispatch on the
  last `:`-segment of the feature `external_id`.
- `src/samsung/rest.js`: `GET http://<ip>:8001/api/v2/`, 2 s timeout. **Every failure resolves to `null`**
  (= off/unreachable); non-`Samsung SmartTV` `type` → `null`. Missing `PowerState` (old models) means `'on'`.
- `src/samsung/upnp.js`: hand-rolled SOAP to `:9197/upnp/control/RenderingControl1` (Get/SetVolume,
  Get/SetMute, `InstanceID 0`, `Channel Master`), 3 s timeout, regex parsing. Faults are HTTP 500 with
  `<errorDescription>`. `setVolume` clamps/rounds to 0–100.
- `src/samsung/remote.js`: `wss://<ip>:8002/api/v2/channels/samsung.remote.control?name=<b64 "Gladys">&token=`.
  Uses the `ws` package only because the TV cert is self-signed (`rejectUnauthorized: false`). One cached
  connection per TV id (`connections` Map of promises). Ready only on `ms.channel.connect` (token in
  `data.token` is saved), `ms.channel.unauthorized` = denied. Timeouts: 10 s with token, 30 s when pairing.
- `src/samsung/keys.js`: key names and source option values (`key:KEY_TV`, `key:KEY_HDMI`, `app:<appId>`).
- `src/samsung/tokenStore.js`: pairing tokens.

## Identifiers and params (must stay stable)

- Device: `ext:samsung-tv:tv:<uuid>` via `gladys.externalIds('tv', info.id)`; `<uuid>` is the TV's UPnP id
  **including the `uuid:` prefix** (e.g. `ext:samsung-tv:tv:uuid:261dc7…`). `readTarget()` recovers it with
  `split(':').slice(3).join(':')`: do not change that parsing.
- Features: `<device>:power|volume|volume-up|volume-down|mute|source`.
- Device params: `IP_ADDRESS`, `MAC_ADDRESS` (may be `''`), `MODEL`. The IP is frozen at discovery; a new IP needs
  a rescan (deliberately no auto re-resolution).
- Source options are **strings** (`text`/`select` feature, not `television`/`source`) so values don't shift
  when apps are added/removed. Keep the `key:`/`app:` prefixes. App list comes from WS `ed.installedApp.get`
  at scan time only, best effort (many 2021+ models ignore it: empty list is normal).
- Every feature must declare numeric `min`/`max` (DB NOT NULL, 422 otherwise); the select uses `0/0`.
- `/data/tokens.json` (`DATA_DIR` overrides `/data`): `{ "<uuid>": "<token>" }`, keyed by the same id.

## Behaviours and pitfalls

- Power on = `gladys.wakeOnLan(mac)` (manifest `network_wake: true`); no state published, next poll tells the
  truth. Fails with a readable error if no MAC. Power off = `KEY_POWER` + close socket + publish `0`.
- Volume/mute go through UPnP (absolute, no pairing); volume up/down go through WS keys (needs pairing).
- A TV in standby shuts its network off: it is invisible to scan and REST. Poll only reads UPnP when on, and
  closes the WS socket when off.
- Poll checks the uuid answering at the IP; a different TV (DHCP swap) is treated as unreachable, warned once
  (`moved` Set).
- `lastPublished` cache: only changed states are published, and only **after** Gladys accepted them (so refused
  batches retry). Cleared on every `connected`, per device on `onDeviceDeleted` (`forgetPublished`).
- `connect()` rejection is logged, not fatal: the SDK retries (Gladys closes with 4000 while booting).
- Token writes: queued (parallel pairing during a scan), tmp file + `rename`, mode `0600`; a non-object or
  truncated file reads as `{}`; write errors are logged, never thrown.
- Manifest declares a single SSDP capture on purpose (the core only scans the first);
  `RenderingControl:1` because recent Tizen no longer announces `RemoteControlReceiver`.
- Every `onAction` key in `index.js` must be declared in the manifest (`test/manifest.test.js` checks it).

## Tests

- `test/helpers/fakeGladys.js`: `createFakeGladys({ scanResults, publishFailures })` records `published`,
  `discovered`, `wakeOnLanCalls`, `connectionStatuses`; `publishFailures` makes the next N publishes throw.
- Real HTTP stubs listen on fixed ports `127.0.0.1:8001` (`discovery.test.js`) and `:9197` (`upnp.test.js`):
  **one server per file** in `before`, swap only the responder (restarting per test breaks undici keep-alive,
  `UND_ERR_SOCKET`). Other files stub `fetch` with `mock.method(globalThis, 'fetch', …)` since files run in parallel.
- `poll.test.js`: use a distinct uuid per test, the module-level publish cache leaks otherwise.
- `lifecycle.test.js` spawns `index.js` as a child process against a `ws` stub of Gladys.
- `tokenStore.test.js` sets `DATA_DIR` to a temp dir. Fixtures in `rest`/`upnp` tests are verbatim captures from
  a real UE55AU7025KXXC. `remote.js` (WebSocket) has no unit tests.
