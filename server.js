import 'dotenv/config';
import express from 'express';
import { MongoClient, ServerApiVersion } from 'mongodb';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || 'sambethel_taste';
const ADMIN_KEY = process.env.ADMIN_KEY;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI. Copy .env.example to .env and add your MongoDB connection string.');
  process.exit(1);
}
if (!ADMIN_KEY) {
  console.error('Missing ADMIN_KEY. Set a strong private admin password in .env.');
  process.exit(1);
}

const client = new MongoClient(MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true
  }
});

let feedback;
const sessions = new Map();
const loginAttempts = new Map();

app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const allowedImprovements = new Set([
  'Better taste',
  'Better freshness',
  'Softer texture',
  'Lower price',
  'Better packaging',
  'Larger size',
  'Healthier ingredients',
  'No improvement needed',
  'Other'
]);

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function validateFeedback(body) {
  const quality = Number(body.quality);
  const taste = Number(body.taste);
  const freshness = Number(body.freshness);
  const value = cleanText(body.value, 20);
  const improvement = cleanText(body.improvement, 80);
  const comment = cleanText(body.comment, 1000);
  const validScore = n => Number.isInteger(n) && n >= 1 && n <= 5;

  if (!validScore(quality)) return { error: 'Please select a valid bread quality rating.' };
  if (!validScore(taste)) return { error: 'Please select a valid taste rating.' };
  if (!validScore(freshness)) return { error: 'Please select a valid freshness rating.' };
  if (!['Yes', 'No', 'Not Sure'].includes(value)) return { error: 'Please select a valid value-for-money answer.' };
  if (!allowedImprovements.has(improvement)) return { error: 'Please select a valid improvement option.' };

  return { value: { quality, taste, freshness, value, improvement, comment } };
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header.split(';').map(part => part.trim()).filter(Boolean).map(part => {
      const idx = part.indexOf('=');
      if (idx < 0) return [part, ''];
      return [decodeURIComponent(part.slice(0, idx)), decodeURIComponent(part.slice(idx + 1))];
    })
  );
}

function passwordMatches(supplied, expected) {
  const a = createHash('sha256').update(String(supplied)).digest();
  const b = createHash('sha256').update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

function sessionFromRequest(req) {
  const token = parseCookies(req).sambethel_admin;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return { token, session };
}

function requireAdmin(req, res, next) {
  const auth = sessionFromRequest(req);
  if (!auth) return res.status(401).json({ error: 'Admin authentication required.' });
  req.adminSession = auth;
  next();
}

function setAdminCookie(res, token) {
  const secure = IS_PRODUCTION ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `sambethel_admin=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`
  );
}

function clearAdminCookie(res) {
  const secure = IS_PRODUCTION ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sambethel_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}

function loginAllowed(req) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const history = (loginAttempts.get(ip) || []).filter(ts => now - ts < windowMs);
  if (history.length >= 8) return false;
  history.push(now);
  loginAttempts.set(ip, history);
  return true;
}

function clearLoginAttempts(req) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  loginAttempts.delete(ip);
}

app.get('/api/health', async (_req, res) => {
  try {
    await client.db('admin').command({ ping: 1 });
    res.json({ ok: true, database: 'connected' });
  } catch {
    res.status(503).json({ ok: false, database: 'unavailable' });
  }
});

app.post('/api/feedback', async (req, res, next) => {
  try {
    const checked = validateFeedback(req.body || {});
    if (checked.error) return res.status(400).json({ error: checked.error });

    const doc = { ...checked.value, createdAt: new Date() };
    const result = await feedback.insertOne(doc);
    res.status(201).json({ ok: true, id: result.insertedId.toString() });
  } catch (err) {
    next(err);
  }
});

app.post('/api/admin/login', async (req, res) => {
  if (!loginAllowed(req)) {
    return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
  }

  const password = cleanText(req.body?.password, 300);
  if (!password || !passwordMatches(password, ADMIN_KEY)) {
    return res.status(401).json({ error: 'Incorrect admin password.' });
  }

  clearLoginAttempts(req);
  const token = randomBytes(32).toString('hex');
  sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
  setAdminCookie(res, token);
  res.json({ ok: true });
});

app.get('/api/admin/session', (req, res) => {
  res.json({ authenticated: Boolean(sessionFromRequest(req)) });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  sessions.delete(req.adminSession.token);
  clearAdminCookie(res);
  res.json({ ok: true });
});

app.get('/api/dashboard', requireAdmin, async (_req, res, next) => {
  try {
    const [summaryRows, qualityRows, tasteRows, freshnessRows, improvementRows, valueRows, recent] = await Promise.all([
      feedback.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            avgQuality: { $avg: '$quality' },
            avgTaste: { $avg: '$taste' },
            avgFreshness: { $avg: '$freshness' },
            qualityPositive: { $sum: { $cond: [{ $gte: ['$quality', 4] }, 1, 0] } },
            tastePositive: { $sum: { $cond: [{ $gte: ['$taste', 4] }, 1, 0] } },
            freshnessPositive: { $sum: { $cond: [{ $gte: ['$freshness', 4] }, 1, 0] } },
            valueYes: { $sum: { $cond: [{ $eq: ['$value', 'Yes'] }, 1, 0] } },
            comments: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$comment', ''] } }, 0] }, 1, 0] } },
            firstResponse: { $min: '$createdAt' },
            lastResponse: { $max: '$createdAt' }
          }
        }
      ]).toArray(),
      feedback.aggregate([{ $group: { _id: '$quality', count: { $sum: 1 } } }, { $sort: { _id: -1 } }]).toArray(),
      feedback.aggregate([{ $group: { _id: '$taste', count: { $sum: 1 } } }, { $sort: { _id: -1 } }]).toArray(),
      feedback.aggregate([{ $group: { _id: '$freshness', count: { $sum: 1 } } }, { $sort: { _id: -1 } }]).toArray(),
      feedback.aggregate([{ $group: { _id: '$improvement', count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }]).toArray(),
      feedback.aggregate([{ $group: { _id: '$value', count: { $sum: 1 } } }, { $sort: { count: -1 } }]).toArray(),
      feedback.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(15).toArray()
    ]);

    const raw = summaryRows[0] || {};
    const total = raw.total || 0;
    const avgQuality = total ? Number(raw.avgQuality.toFixed(2)) : 0;
    const avgTaste = total ? Number(raw.avgTaste.toFixed(2)) : 0;
    const avgFreshness = total ? Number(raw.avgFreshness.toFixed(2)) : 0;
    const pct = count => total ? Math.round((count / total) * 100) : 0;
    const overallScorePercent = total ? Math.round(((avgQuality + avgTaste + avgFreshness) / 15) * 100) : 0;

    res.json({
      summary: {
        total,
        avgQuality,
        avgTaste,
        avgFreshness,
        qualityPositivePercent: pct(raw.qualityPositive || 0),
        tasteSatisfactionPercent: pct(raw.tastePositive || 0),
        freshnessSatisfactionPercent: pct(raw.freshnessPositive || 0),
        valueYesPercent: pct(raw.valueYes || 0),
        commentPercent: pct(raw.comments || 0),
        overallScorePercent,
        firstResponse: raw.firstResponse || null,
        lastResponse: raw.lastResponse || null
      },
      ratings: {
        quality: qualityRows.map(row => ({ score: row._id, count: row.count })),
        taste: tasteRows.map(row => ({ score: row._id, count: row.count })),
        freshness: freshnessRows.map(row => ({ score: row._id, count: row.count }))
      },
      improvements: improvementRows.map(row => ({ label: row._id, count: row.count })),
      value: valueRows.map(row => ({ label: row._id, count: row.count })),
      recent
    });
  } catch (err) {
    next(err);
  }
});

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

app.get('/api/export.csv', requireAdmin, async (_req, res, next) => {
  try {
    const rows = await feedback.find({}).sort({ createdAt: 1 }).toArray();
    const header = ['Timestamp', 'Quality', 'Taste', 'Freshness', 'Value for Money', 'Improvement', 'Comment'];
    const lines = [header.map(csvCell).join(',')];

    for (const row of rows) {
      lines.push([
        row.createdAt?.toISOString?.() || row.createdAt,
        row.quality,
        row.taste,
        row.freshness,
        row.value,
        row.improvement,
        row.comment
      ].map(csvCell).join(','));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sambethel_taste_feedback.csv"');
    res.send('\uFEFF' + lines.join('\n'));
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error. Please try again.' });
});

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
}, 30 * 60 * 1000).unref();

async function start() {
  await client.connect();
  await client.db('admin').command({ ping: 1 });
  const db = client.db(DB_NAME);
  feedback = db.collection('feedback');
  await feedback.createIndex({ createdAt: -1 });
  console.log(`Connected to MongoDB database: ${DB_NAME}`);
  app.listen(PORT, () => console.log(`Sambethel Taste running on http://localhost:${PORT}`));
}

start().catch(err => {
  console.error('Could not start server:', err);
  process.exit(1);
});

async function shutdown() {
  try { await client.close(); } finally { process.exit(0); }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
