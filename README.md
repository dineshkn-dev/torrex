# Torrex - Local Torrent Downloader

A Node.js + WebTorrent app with a modern browser UI for downloading torrents from magnet links or .torrent files.

## What it does

- Add torrents using a magnet link or file upload.
- Preview metadata before adding (name, size, file list).
- Track live progress, speeds, and peers.
- Filter by folders in the sidebar: `All`, `In Progress`, `Completed`, `Failed`, `Seeding Off`.
- Select multiple torrents and run bulk actions.
- Stop/resume seeding per torrent or in bulk.
- Open a torrent folder directly in Finder/Explorer.
- Persist torrent state across restarts via `state.json`.
- Change download directory from the UI (`config.json` is updated).

## Requirements

- Node.js 18+
- npm

## Quick start

```bash
npm install
npm start
```

Open: `http://localhost:3000`

## Keyboard shortcuts

- `Cmd+A` / `Ctrl+A`: Select all visible torrents
- `Arrow Up` / `Arrow Down`: Move card focus
- `Shift + Arrow Up/Down`: Extend selection while moving focus
- `Esc`: Close shortcuts panel, then clear selection/focus
- `?`: Open keyboard shortcuts help

## Project structure

- `server.js`: Express API + WebTorrent engine
- `public/index.html`: App shell and modal markup
- `public/app.js`: Frontend behavior and API interactions
- `public/styles.css`: Styling
- `config.json`: Current download directory
- `state.json`: Persisted torrent/seeding state
- `downloads/`: Download output location
- `tmp/`: Temporary upload/preview files

## API overview

- `GET /api/torrents`
- `GET /api/torrents/:hash`
- `POST /api/torrents/preview`
- `POST /api/torrents/preview/file`
- `POST /api/torrents`
- `POST /api/torrents/file`
- `DELETE /api/torrents/:hash`
- `POST /api/torrents/:hash/retry`
- `POST /api/torrents/:hash/stop-seeding`
- `POST /api/torrents/:hash/resume-seeding`
- `POST /api/torrents/:hash/open`
- `GET /api/fs/browse`
- `GET /api/config`
- `PATCH /api/config`
- `GET /api/test-torrents`

## Security and usage notes

- This is a local utility app; do not expose it publicly without authentication and network hardening.
- Use only content you are authorized to download/share.
- For very large or long-running torrent workloads, a dedicated desktop client may be more suitable.

## License

MIT (see `LICENSE`).
