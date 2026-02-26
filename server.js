import express    from 'express';
import cors       from 'cors';
import path       from 'path';
import fs         from 'fs';
import multer     from 'multer';
import WebTorrent from 'webtorrent';

const app  = express();
const PORT = process.env.PORT || 3000;

const __dirname          = import.meta.dirname;
const DOWNLOAD_DIR       = path.join(__dirname, 'downloads');
const TMP_DIR            = path.join(__dirname, 'tmp');
const STATE_FILE         = path.join(__dirname, 'state.json');
const PREVIEW_TIMEOUT_MS = 30_000;

for (const d of [DOWNLOAD_DIR, TMP_DIR]) fs.mkdirSync(d, { recursive: true });

/* ─── WebTorrent client ──────────────────────────────────────────────────── */
const client = new WebTorrent();

client.on('error', err => console.error('[webtorrent]', err.message));

/* ─── State persistence ──────────────────────────────────────────────────── */
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return []; }
}

function saveState() {
  const state = client.torrents.map(t => ({
    infoHash: t.infoHash,
    magnet:   t.magnetURI,
    paused:   !!t._paused,
  }));
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch (e) {
    console.error('[state]', e.message);
  }
}

/* ─── Format torrent for frontend ───────────────────────────────────────── */
function fmt(t) {
  const totalLength = t.length     || 0;
  const downloaded  = t.downloaded || 0;
  const done        = totalLength > 0 && downloaded >= totalLength;
  const rawProgress = totalLength > 0 ? (downloaded / totalLength) * 100 : 0;
  const progress    = done ? 100 : Math.min(99.9, rawProgress);

  return {
    infoHash:      t.infoHash,
    name:          t.name  || null,
    progress:      Math.round(progress * 10) / 10,
    downloadSpeed: t.downloadSpeed || 0,
    uploadSpeed:   t.uploadSpeed   || 0,
    numPeers:      t.numPeers      || 0,
    length:        totalLength,
    downloaded,
    done,
    paused:  !!t._paused,
    failed:  !!t._failed,
    files: (t.files || []).map(f => ({
      name:     f.name,
      length:   f.length,
      progress: Math.round((f.progress || 0) * 1000) / 10,
    })),
  };
}

/* ─── Middleware ─────────────────────────────────────────────────────────── */
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const upload = multer({ dest: TMP_DIR });

/* ─── Restore state on startup ───────────────────────────────────────────── */
for (const entry of loadState()) {
  if (!entry.magnet) continue;
  try {
    client.add(entry.magnet, { path: DOWNLOAD_DIR }, torrent => {
      if (entry.paused) { torrent._paused = true; torrent.pause(); }
      torrent.on('error', err => { torrent._failed = true; torrent._error = err.message; saveState(); });
    });
  } catch { /* skip bad entries */ }
}

/* ─── GET /api/torrents ──────────────────────────────────────────────────── */
app.get('/api/torrents', (req, res) => {
  res.json(client.torrents.map(fmt));
});

/* ─── GET /api/torrents/:hash ────────────────────────────────────────────── */
app.get('/api/torrents/:hash', (req, res) => {
  const t = client.get(req.params.hash);
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(fmt(t));
});

/* ─── POST /api/torrents/preview  (magnet) ─────────────────────────────── */
// NOTE: must be registered before /api/torrents/:hash
app.post('/api/torrents/preview', (req, res) => {
  const magnet = req.body?.magnet?.trim();
  if (!magnet?.startsWith('magnet:')) return res.status(400).json({ error: 'Valid magnet link required' });

  const previewDir = path.join(TMP_DIR, `preview-${Date.now()}`);
  fs.mkdirSync(previewDir, { recursive: true });

  let settled = false;
  const settle = (cb) => { if (settled) return; settled = true; cb(); };

  let t;
  const timer = setTimeout(() => {
    settle(() => {
      res.status(408).json({ error: 'Metadata timeout — peers unreachable' });
      if (t) t.destroy({ destroyStore: true }, () =>
        fs.rm(previewDir, { recursive: true, force: true }, () => {}));
    });
  }, PREVIEW_TIMEOUT_MS);

  try {
    t = client.add(magnet, { path: previewDir });
  } catch (err) {
    clearTimeout(timer);
    fs.rm(previewDir, { recursive: true, force: true }, () => {});
    return res.status(500).json({ error: err.message });
  }

  t.on('ready', () => {
    clearTimeout(timer);
    settle(() => {
      res.json({
        name:   t.name,
        length: t.length,
        files:  t.files.map(f => ({ name: f.name, length: f.length })),
      });
      t.destroy({ destroyStore: true }, () =>
        fs.rm(previewDir, { recursive: true, force: true }, () => {}));
    });
  });

  t.on('error', err => {
    clearTimeout(timer);
    settle(() => {
      res.status(500).json({ error: err.message });
      fs.rm(previewDir, { recursive: true, force: true }, () => {});
    });
  });
});

/* ─── POST /api/torrents/preview/file  (.torrent) ─────────────────────── */
app.post('/api/torrents/preview/file', upload.single('torrent'), (req, res) => {
  if (!req.file?.path) return res.status(400).json({ error: 'No .torrent file uploaded' });

  const previewDir = path.join(TMP_DIR, `preview-${Date.now()}`);
  fs.mkdirSync(previewDir, { recursive: true });

  const cleanup = () => {
    fs.rm(previewDir, { recursive: true, force: true }, () => {});
    fs.unlink(req.file.path, () => {});
  };

  let t;
  try {
    t = client.add(req.file.path, { path: previewDir });
  } catch (err) {
    cleanup();
    return res.status(500).json({ error: err.message });
  }

  t.on('ready', () => {
    res.json({
      name:   t.name,
      length: t.length,
      files:  t.files.map(f => ({ name: f.name, length: f.length })),
    });
    t.destroy({ destroyStore: true }, cleanup);
  });

  t.on('error', err => {
    res.status(500).json({ error: err.message });
    t.destroy({ destroyStore: true }, cleanup);
  });
});

/* ─── POST /api/torrents  (add magnet) ───────────────────────────────────── */
app.post('/api/torrents', (req, res) => {
  const magnet = req.body?.magnet?.trim();
  if (!magnet?.startsWith('magnet:')) return res.status(400).json({ error: 'Valid magnet link required' });

  const existing = client.get(magnet);
  if (existing) return res.json(fmt(existing));

  try {
    const t = client.add(magnet, { path: DOWNLOAD_DIR }, () => saveState());
    t.on('error', err => { t._failed = true; t._error = err.message; saveState(); });
    saveState();
    res.json(fmt(t));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─── POST /api/torrents/file  (add .torrent) ────────────────────────────── */
app.post('/api/torrents/file', upload.single('torrent'), (req, res) => {
  if (!req.file?.path) return res.status(400).json({ error: 'No .torrent file uploaded' });

  try {
    const t = client.add(req.file.path, { path: DOWNLOAD_DIR }, torrent => {
      saveState();
      fs.unlink(req.file.path, () => {});
    });
    t.on('error', err => { t._failed = true; t._error = err.message; saveState(); });
    saveState();
    res.json(fmt(t));
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: err.message });
  }
});

/* ─── PATCH /api/torrents/:hash  (pause / resume) ────────────────────────── */
app.patch('/api/torrents/:hash', (req, res) => {
  const t = client.get(req.params.hash);
  if (!t) return res.status(404).json({ error: 'Not found' });

  if (req.body?.pause) { t._paused = true;  t.pause(); }
  else                  { t._paused = false; t.resume(); }

  saveState();
  res.json({ ok: true });
});

/* ─── DELETE /api/torrents/:hash ─────────────────────────────────────────── */
app.delete('/api/torrents/:hash', (req, res) => {
  const t = client.get(req.params.hash);
  if (!t) return res.status(404).json({ error: 'Not found' });

  t.destroy({ destroyStore: false }, err => {
    if (err) return res.status(500).json({ error: err.message });
    saveState();
    res.json({ ok: true });
  });
});

/* ─── POST /api/torrents/:hash/retry ─────────────────────────────────────── */
app.post('/api/torrents/:hash/retry', (req, res) => {
  const existing = client.get(req.params.hash);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const magnet = existing.magnetURI;
  existing.destroy({ destroyStore: false }, () => {
    try {
      const t = client.add(magnet, { path: DOWNLOAD_DIR }, () => saveState());
      t.on('error', err => { t._failed = true; saveState(); });
      saveState();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
});

/* ─── POST /api/trackers/refresh  (no-op for WebTorrent) ────────────────── */
app.post('/api/trackers/refresh', (req, res) => res.json({ count: 0 }));

/* ─── 404 for unknown API routes ─────────────────────────────────────────── */
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

/* ─── Start ──────────────────────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`\nTorrent Downloader  →  http://localhost:${PORT}`);
  console.log(`Downloads           →  ${DOWNLOAD_DIR}`);
  console.log(`Engine              →  WebTorrent\n`);
});
