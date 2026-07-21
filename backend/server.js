require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const sharp = require('sharp');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');
const rateLimit = require('express-rate-limit');

const db = require('./db');
const { checkText } = require('./moderation');

const app = express();
const PORT = process.env.PORT || 3001;
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me-please';
const REPORT_HIDE_THRESHOLD = parseInt(process.env.REPORT_HIDE_THRESHOLD || '3', 10);
const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1d' }));

// --- helpers -----------------------------------------------------------

function hashIp(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  return crypto.createHash('sha256').update(ip + (process.env.IP_SALT || 'salt')).digest('hex').slice(0, 24);
}

function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (key !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// --- rate limiting -------------------------------------------------------

const postLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5, // 5 posts per IP per 10 min
  message: { error: 'Slow down — you\'re posting too fast. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const reportLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: { error: 'Too many reports from this IP, try again later.' },
});

// --- image upload / processing -----------------------------------------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only jpg, png, webp, or gif images are allowed.'));
    }
    cb(null, true);
  },
});

/**
 * Re-encodes the image (strips EXIF/GPS metadata for poster privacy),
 * caps dimensions, and writes it to disk. Returns the stored filename.
 *
 * NOTE: This does NOT run automated NSFW/CSAM detection. For a real
 * public deployment you should wire in a moderation API here (e.g.
 * Sightengine, Hive, AWS Rekognition Moderation, Google Vision SafeSearch)
 * before saving the file. See README "Image moderation" section.
 */
async function processAndSaveImage(buffer) {
  const filename = `${nanoid()}.webp`;
  const outPath = path.join(UPLOAD_DIR, filename);
  await sharp(buffer)
    .rotate() // respect orientation before stripping metadata
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(outPath); // sharp strips EXIF/metadata by default on re-encode
  return filename;
}

// --- routes --------------------------------------------------------------

app.get('/api/health', (req, res) => res.json({ ok: true }));

// List visible posts, newest first
app.get('/api/posts', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '30', 10), 100);
  const before = req.query.before ? parseInt(req.query.before, 10) : Date.now();

  const rows = db.prepare(
    `SELECT id, text, image_path, created_at FROM posts
     WHERE hidden = 0 AND created_at < ?
     ORDER BY created_at DESC LIMIT ?`
  ).all(before, limit);

  res.json(rows.map((r) => ({
    id: r.id,
    text: r.text,
    imageUrl: r.image_path ? `/uploads/${r.image_path}` : null,
    createdAt: r.created_at,
  })));
});

// Create a post (text and/or image)
app.post('/api/posts', postLimiter, upload.single('image'), async (req, res) => {
  try {
    const rawText = req.body.text || '';
    const hasImage = !!req.file;

    if (!rawText.trim() && !hasImage) {
      return res.status(400).json({ error: 'Post needs text or an image.' });
    }

    let cleanedText = '';
    if (rawText.trim()) {
      const check = checkText(rawText);
      if (!check.ok) return res.status(400).json({ error: check.reason });
      cleanedText = check.cleaned;
    }

    let imageFilename = null;
    if (hasImage) {
      imageFilename = await processAndSaveImage(req.file.buffer);
    }

    const id = nanoid(10);
    const now = Date.now();
    const ipHash = hashIp(req);

    db.prepare(
      `INSERT INTO posts (id, text, image_path, created_at, reports, hidden, ip_hash)
       VALUES (?, ?, ?, ?, 0, 0, ?)`
    ).run(id, cleanedText, imageFilename, now, ipHash);

    res.status(201).json({
      id,
      text: cleanedText,
      imageUrl: imageFilename ? `/uploads/${imageFilename}` : null,
      createdAt: now,
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || 'Upload failed.' });
  }
});

// Report a post -- one report per IP per post, auto-hides at threshold
app.post('/api/posts/:id/report', reportLimiter, (req, res) => {
  const { id } = req.params;
  const ipHash = hashIp(req);

  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  if (!post) return res.status(404).json({ error: 'Post not found.' });

  try {
    db.prepare('INSERT INTO report_log (post_id, ip_hash, created_at) VALUES (?, ?, ?)')
      .run(id, ipHash, Date.now());
  } catch (e) {
    // UNIQUE constraint -- this IP already reported this post
    return res.status(200).json({ ok: true, alreadyReported: true });
  }

  const newCount = post.reports + 1;
  const shouldHide = newCount >= REPORT_HIDE_THRESHOLD ? 1 : post.hidden;

  db.prepare('UPDATE posts SET reports = ?, hidden = ? WHERE id = ?')
    .run(newCount, shouldHide, id);

  res.json({ ok: true, reports: newCount, hidden: !!shouldHide });
});

// --- admin routes (protected by x-admin-key header) ----------------------

app.get('/api/admin/posts', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM posts ORDER BY created_at DESC LIMIT 200').all();
  res.json(rows.map((r) => ({
    id: r.id,
    text: r.text,
    imageUrl: r.image_path ? `/uploads/${r.image_path}` : null,
    createdAt: r.created_at,
    reports: r.reports,
    hidden: !!r.hidden,
  })));
});

app.post('/api/admin/posts/:id/hide', requireAdmin, (req, res) => {
  db.prepare('UPDATE posts SET hidden = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/admin/posts/:id/unhide', requireAdmin, (req, res) => {
  db.prepare('UPDATE posts SET hidden = 0, reports = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/admin/posts/:id', requireAdmin, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (post?.image_path) {
    const p = path.join(UPLOAD_DIR, post.image_path);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM report_log WHERE post_id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`TMA Leaks backend running on port ${PORT}`);
  if (ADMIN_KEY === 'change-me-please') {
    console.warn('⚠️  Set a real ADMIN_KEY in your environment before deploying!');
  }
});
