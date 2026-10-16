import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { db, nowISO } from './db.js';
import { rankTrucks } from './matching.js';

const PORT = Number(process.env.PORT || 3000);
const root = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(root, 'public');
const q = (sql, ...p) => db.prepare(sql).all(...p);
const one = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);

const EQUIPMENT = ['dryvan', 'reefer', 'flatbed', 'stepdeck', 'tanker'];
const loadFields = ['ref', 'shipper', 'commodity', 'origin_city', 'origin_state', 'dest_city', 'dest_state', 'pickup_date', 'equipment', 'weight_lb', 'offered_rate_cents', 'shipper_phone', 'notes'];
const truckFields = ['driver', 'phone', 'equipment', 'capacity_lb', 'city', 'state', 'available_date', 'min_rate_cents', 'truck_number', 'notes'];
const OPTIONAL = new Set(['shipper_phone', 'notes', 'truck_number']);

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => { throw new HttpError(400, msg); };

function insert(table, fields, body) {
  const missing = fields.filter((f) => !OPTIONAL.has(f) && (body[f] === undefined || body[f] === null || body[f] === ''));
  if (missing.length) bad(`missing: ${missing.join(', ')}`);
  const rows = fields.map((f) => {
    let v = body[f];
    if (v === undefined || v === null) v = '';
    if (typeof v === 'string') v = v.trim();
    if (f.endsWith('_cents') || f.endsWith('_lb')) {
      v = Math.round(Number(v));
      if (!Number.isFinite(v) || v <= 0) bad(`${f} must be a positive number`);
    }
    if (f === 'equipment') {
      v = String(v).toLowerCase();
      if (!EQUIPMENT.includes(v)) bad(`equipment must be one of ${EQUIPMENT.join(', ')}`);
    }
    if (f.endsWith('_date') && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) bad(`${f} must be YYYY-MM-DD`);
    if (f.endsWith('state') || (f === 'state')) v = String(v).toUpperCase().slice(0, 2);
    return v;
  });
  let info;
  try {
    info = run(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`, ...rows);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, `${table}: ${e.message}`);
    throw e;
  }
  return one(`SELECT * FROM ${table} WHERE id = ?`, info.lastInsertRowid);
}

function setStatus(table, id, status, allowed) {
  if (allowed && !allowed.includes(status)) bad(`status must be one of ${allowed.join(', ')}`);
  const row = one(`SELECT * FROM ${table} WHERE id = ?`, id);
  if (!row) throw new HttpError(404, `${table} ${id} not found`);
  run(`UPDATE ${table} SET status = ? WHERE id = ?`, status, id);
  return one(`SELECT * FROM ${table} WHERE id = ?`, id);
}

function loadDetail(id) {
  const load = one('SELECT * FROM loads WHERE id = ?', id);
  if (!load) throw new HttpError(404, `load ${id} not found`);
  const offers = q('SELECT o.*, t.driver, t.truck_number FROM offers o JOIN trucks t ON t.id = o.truck_id WHERE o.load_id = ? ORDER BY o.created_at, o.id', id);
  const trucks = q("SELECT * FROM trucks WHERE status = 'available' OR id IN (SELECT truck_id FROM offers WHERE load_id = ?)", id);
  return {
    load,
    offers,
    assignment: one('SELECT a.*, t.driver, t.truck_number FROM assignments a JOIN trucks t ON t.id = a.truck_id WHERE a.load_id = ?', id),
    matches: rankTrucks(trucks, load),
  };
}

function acceptOffer(offerId) {
  const offer = one('SELECT * FROM offers WHERE id = ?', offerId);
  if (!offer) throw new HttpError(404, `offer ${offerId} not found`);
  if (offer.status !== 'open') bad(`offer is ${offer.status}`);
  const dup = one('SELECT * FROM assignments WHERE load_id = ?', offer.load_id);
  if (dup) bad('load is already booked — revoke that assignment first');
  run('UPDATE offers SET status = ? WHERE load_id = ? AND id != ? AND status = ?', 'rejected', offer.load_id, offer.id, 'open');
  run('UPDATE offers SET status = ? WHERE id = ?', 'accepted', offer.id);
  run('INSERT INTO assignments (load_id, truck_id, rate_cents) VALUES (?, ?, ?)', offer.load_id, offer.truck_id, offer.rate_cents);
  run("UPDATE loads SET status = 'booked' WHERE id = ?", offer.load_id);
  run("UPDATE trucks SET status = 'booked' WHERE id = ?", offer.truck_id);
  return loadDetail(offer.load_id);
}

// --- tiny router -------------------------------------------------------------
const api = {
  'GET /api/board': () => ({
    loads: q("SELECT * FROM loads WHERE status IN ('open','negotiating') ORDER BY pickup_date"),
    trucks: q("SELECT * FROM trucks WHERE status = 'available' ORDER BY available_date"),
    booked: q('SELECT a.*, l.ref, l.origin_city, l.origin_state, l.dest_city, l.dest_state, t.driver FROM assignments a JOIN loads l ON l.id=a.load_id JOIN trucks t ON t.id=a.truck_id ORDER BY a.created_at DESC LIMIT 50'),
  }),
  'POST /api/loads': (body) => insert('loads', loadFields, body),
  'GET /api/loads/:id': (id) => loadDetail(Number(id)),
  'POST /api/loads/:id/status': (id, body) => ({ load: setStatus('loads', Number(id), body.status, ['open', 'negotiating', 'booked', 'cancelled']) }),
  'POST /api/trucks': (body) => insert('trucks', truckFields, body),
  'GET /api/trucks/:id/matches': (id) => {
    const truck = one('SELECT * FROM trucks WHERE id = ?', Number(id));
    if (!truck) throw new HttpError(404, `truck ${id} not found`);
    return q("SELECT * FROM loads WHERE status IN ('open','negotiating')")
      .map((l) => {
        const [ranked] = rankTrucks([truck], l);
        return ranked ? { load: l, ...ranked } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.total - a.total);
  },
  'POST /api/matches': (body) => {
    const load = one('SELECT * FROM loads WHERE id = ?', Number(body.load_id));
    if (!load) throw new HttpError(404, 'load not found');
    return { load, matches: rankTrucks(q("SELECT * FROM trucks WHERE status = 'available'"), load) };
  },
  'POST /api/offers': (body) => {
    const load = one('SELECT * FROM loads WHERE id = ?', Number(body.load_id));
    const truck = one('SELECT * FROM trucks WHERE id = ?', Number(body.truck_id));
    if (!load || !truck) throw new HttpError(404, 'load or truck not found');
    if (load.status === 'booked') bad('load is already booked');
    if (truck.status === 'booked') bad('truck is already booked');
    if (!['broker', 'truck'].includes(body.by)) bad("by must be 'broker' or 'truck'");
    const rate = Math.round(Number(body.rate_cents));
    if (!Number.isFinite(rate) || rate <= 0) bad('rate_cents must be a positive number');
    run('INSERT INTO offers (load_id, truck_id, by, rate_cents, note) VALUES (?, ?, ?, ?, ?)', load.id, truck.id, body.by, rate, String(body.note || ''));
    run("UPDATE loads SET status = 'negotiating' WHERE id = ? AND status = 'open'", load.id);
    return loadDetail(load.id);
  },
  'POST /api/offers/:id/accept': (id) => acceptOffer(Number(id)),
  'POST /api/offers/:id/reject': (id) => {
    const offer = one('SELECT * FROM offers WHERE id = ?', Number(id));
    if (!offer) throw new HttpError(404, `offer ${id} not found`);
    if (offer.status !== 'open') bad(`offer is ${offer.status}`);
    run("UPDATE offers SET status = 'rejected' WHERE id = ?", offer.id);
    return loadDetail(offer.load_id);
  },
  'POST /api/assignments/:id/revoke': (id) => {
    const a = one('SELECT * FROM assignments WHERE id = ?', Number(id));
    if (!a) throw new HttpError(404, `assignment ${id} not found`);
    run('DELETE FROM assignments WHERE id = ?', a.id);
    run("UPDATE loads SET status = 'negotiating' WHERE id = ?", a.load_id);
    run("UPDATE trucks SET status = 'available' WHERE id = ?", a.truck_id);
    run("UPDATE offers SET status = 'open' WHERE load_id = ? AND truck_id = ?", a.load_id, a.truck_id);
    return loadDetail(a.load_id);
  },
};

// --- plumbing ----------------------------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) { reject(new HttpError(413, 'payload too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new HttpError(400, 'invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'api') {
      const raw = parts.slice(1);
      const key = `${req.method} /api/${raw.map((p) => (/^\d+$/.test(p) ? ':id' : p)).join('/')}`;
      const handler = api[key];
      if (!handler) throw new HttpError(404, `no route ${req.method} ${url.pathname}`);
      const args = key.split('/').slice(2).map((seg, i) => (seg === ':id' ? Number(raw[i]) : null)).filter((a) => a !== null);
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      const out = await handler(...args, body);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(out));
    }
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.join(pub, rel);
    if (!file.startsWith(pub)) throw new HttpError(403, 'forbidden');
    let data;
    try {
      data = await fs.readFile(file);
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'EISDIR') throw new HttpError(404, 'not found');
      throw e;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: e.message || 'server error' }));
  }
});

server.listen(PORT, () => {
  console.log(`freightmatch on http://localhost:${PORT}  (db: ${db.location?.() ?? 'file'}, today ${nowISO()})`);
});