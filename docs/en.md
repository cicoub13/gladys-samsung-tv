# Samsung Smart TV

Control your Samsung televisions (Tizen, 2016 models onwards) from Gladys, entirely over the local network: no
Samsung account, nothing going through the cloud.

## What the integration exposes

| Feature          | Detail                                                                |
| ---------------- | --------------------------------------------------------------------- |
| Power            | Turns the TV off, and wakes it up with Wake-on-LAN                    |
| Volume           | A 0 to 100 % slider, showing the level actually read back from the TV |
| Volume up / down | One volume step, like the remote                                      |
| Mute             | Set or cleared, never toggled blindly                                 |
| Source           | TV, HDMI, and the installed apps when the TV reports them             |

## Setup

1. Install the integration from the store, open the **Discovery** tab and run a scan. Your television shows up under
   its own name ("Samsung AU7025 55 TV", for instance). Create it.
2. Run a first command, Volume up for example. The TV then displays an authorization prompt for "Gladys":
   **accept it with the remote**. This happens only once, the token is kept afterwards.

If the TV asks nothing and commands keep failing, check that
_Settings → General → External Device Manager → Device Connection Manager_ still allows new devices.

## Turning the TV back on

A TV that is off answers nothing on the network: the only way in is Wake-on-LAN, a packet Gladys emits towards its
MAC address. This requires the wake-on-network option to be enabled on the TV, under
_Settings → General → Network → Expert settings → **Power On with Mobile**_ (the wording varies across models).

Over Wi-Fi this wake-up depends on the model and is not guaranteed by every television. If turning on does not work
while the option is enabled, an Ethernet link makes it reliable. Turning off always works.

**To find out where you stand**, turn the TV off, then run `ping <TV IP address>` from any machine on the network:

- the TV still answers: its network interface stays alive in standby, and Wake-on-LAN has every chance of working;
- the TV answers nothing at all: it shut its network interface down, no packet can reach it any more and the wake-up
  will fail. That is the symptom of a disabled wake-on-network option — enable it, then run the test again.

## Sources and applications

TV and HDMI are always offered: they are remote-control keys, present on every model.

The list of installed applications is requested from the TV during the scan, but several recent models (2021 and
later) ignore that request. When that happens only TV and HDMI show up — that is expected behaviour, not a failure.
Run a new scan after installing an app: if your model answers, it will be added.

## How it works

Three channels, each for what it does best:

- the TV **REST API** (port 8001) reports the power state, read on every refresh;
- **UPnP RenderingControl** (port 9197) reads and writes the volume level and the mute state, with no token involved;
- the **remote-control WebSocket** (port 8002) carries key presses, the only part needing the authorization.

The pairing token is kept in the integration's `/data` volume: it survives restarts and container updates.
