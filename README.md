# Gladys Samsung Smart TV

External [Gladys Assistant](https://gladysassistant.com) integration to control Samsung televisions (Tizen, 2016
models onwards) over the local network: power, volume, mute and input source. No Samsung account, no cloud.

User documentation: [English](docs/en.md) · [Français](docs/fr.md)

## Design

Three protocols, each used for what it does best:

| Channel                  | Port | Used for                                    | Authentication |
| ------------------------ | ---- | ------------------------------------------- | -------------- |
| REST `api/v2`            | 8001 | Identifying the TV, reading its power state | none           |
| UPnP RenderingControl    | 9197 | Volume level and mute, read **and** write   | none           |
| Remote-control WebSocket | 8002 | Key presses, app launches                   | pairing token  |

The split matters: the WebSocket only carries key presses, so it can neither set a volume level nor read one back —
UPnP can do both, deterministically. Turning the TV **on** is the exception: an off TV answers nothing, so the only
way in is a Wake-on-LAN magic packet, emitted by the Gladys core on the integration's behalf.

Discovery is mediated too: integration containers sit on a bridge network where SSDP never arrives, so the core runs
the M-SEARCH and this integration interprets the answers. The declared search target (`RenderingControl:1`) is
generic — recent Tizen models no longer announce the Samsung-specific `RemoteControlReceiver` — so the REST endpoint
is what actually filters: only a Samsung TV answers port 8001 with `type: "Samsung SmartTV"`.

## Development

Requires Node.js 20 or later (the image ships 24).

```bash
npm install
npm test          # node:test, no network needed
npm run lint
```

To run it against a local Gladys, install it in developer mode (Integrations → Install from GitHub → developer
mode, with any stub image), then read the credentials off the container it created and run the code directly:

```bash
docker inspect gladys-<selector> --format '{{range .Config.Env}}{{println .}}{{end}}' | grep GLADYS_
docker rm -f gladys-<selector>   # a token cannot be shared by two clients

GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="<selector>" \
DATA_DIR=./.data LOG_LEVEL=debug \
npm start
```

`DATA_DIR` overrides where the pairing token is stored (`/data` in the container, which does not exist on a dev
machine).

## License

Apache-2.0
