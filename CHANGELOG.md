# Changelog

All notable changes to this integration are documented here. This project
follows [Semantic Versioning](https://semver.org/) and the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [Unreleased]

### Fixed

- **Power, volume and mute changed with the remote now show up in Gladys.**
  The TVs were never read back, so Gladys only knew what it had set itself.
  They are now refreshed at the "Refresh interval" of the integration settings
  (30 seconds by default), TVs already created included: no new scan needed. A
  TV woken up by Wake-on-LAN is now shown as on within that interval.
