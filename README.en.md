# WeMedia Creator Workstation

A local-first content operations workbench: topics → schedule → publish → review → archive. The UI is plain HTML/CSS/JS served by a zero-dependency Node HTTP server; data lives in a local SQLite database (`node:sqlite`) and multiple tabs stay in sync over SSE.

## Run from source

Requires Node ≥ 22.5 (built-in SQLite).

```bash
npm start                 # http://127.0.0.1:5180
npm start -- --port 8080
```

On first start with an empty `data/` directory, sample records are seeded automatically.

## Desktop builds

The desktop app wraps the same local server with an Electron shell: the main process picks a free port, spawns `server.js`, and loads `http://127.0.0.1:<port>/` in a window. Closing the window hides it to the tray; scheduled publishing keeps running in the background.

- Windows: NSIS installer (no admin required), auto-update enabled
- macOS: dmg / zip for x64 and arm64; unsigned, so right-click → Open on first launch; auto-update disabled
- Linux: AppImage (auto-update) and deb (manual upgrade)

```bash
npm install
npm run dist:win     # dist/WeMedia-Workstation-Setup-<version>.exe
npm run dist:mac     # run on macOS
npm run dist:linux   # recommended on Ubuntu 22.04
```

Behind a slow network, point Electron and NSIS downloads at a mirror:

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
npm run dist:win
```

Runtime data is stored per user, not inside the install directory:

| Platform | Data directory |
|---|---|
| Windows | `%APPDATA%\WeMedia Creator Workstation\data` |
| macOS | `~/Library/Application Support/WeMedia Creator Workstation/data` |
| Linux | `~/.config/WeMedia Creator Workstation/data` |

`logs/server.log` next to it holds the local server output (rotated at 5 MB). To migrate from a source checkout, copy its `data/` directory into the path above. Publishing still needs a local Chrome / Edge installation (override with `CHROME_PATH`).

## Releases and auto-update

The client uses `electron-updater` with the generic provider. Builds embed `PUBLISH_BASE_URL` into `app-update.yml`, and each platform polls `${PUBLISH_BASE_URL}/we-media/${os}/${arch}` for `latest*.yml` plus installers. Windows NSIS and Linux AppImage check 10 seconds after launch and every 4 hours, then prompt to restart once downloaded. deb packages and unsigned macOS builds must be upgraded manually.

To publish:

1. Bump `version` in `package.json` and commit.
2. Tag and push: `git tag v2.0.1 && git push origin v2.0.1`.
3. GitHub Actions (`.github/workflows/release.yml`) verifies tag vs version, runs `npm run check`, and builds win-x64 / linux-x64 / mac-x64 / mac-arm64.
4. The `publish` job uploads artifacts to Aliyun OSS via `tools/upload-oss.js` (`latest*.yml` uncached, installers cached long-term).

Repository configuration:

- Actions variable `PUBLISH_BASE_URL`: public OSS URL, no trailing slash
- Actions secrets: `OSS_REGION`, `OSS_ENDPOINT`, `OSS_BUCKET`, `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET`
