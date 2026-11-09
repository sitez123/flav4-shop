'use strict';
// FLAV4 — shop server. Static site + order engine + email + stock + admin.
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'flav4admin';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'outbox'), { recursive: true });

// ---------- database ----------
const db = new Database(path.join(DATA_DIR, 'flav4.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, number TEXT, brand TEXT, family TEXT, flavour TEXT, series TEXT,
  accent TEXT, artA TEXT, artB TEXT, image TEXT, studio TEXT, real TEXT, description TEXT,
  stock INTEGER NOT NULL DEFAULT 0, sold INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, sort INTEGER
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT UNIQUE, created_at TEXT, status TEXT,
  name TEXT, email TEXT, phone TEXT, country TEXT, country_code TEXT, address1 TEXT, address2 TEXT, city TEXT, region TEXT, postcode TEXT,
  notes TEXT, items TEXT, subtotal REAL, shipping REAL, total REAL, currency TEXT, tracking TEXT, paid_at TEXT, posted_at TEXT, ip TEXT
);
CREATE TABLE IF NOT EXISTS stock_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, product_id TEXT, change INTEGER, reason TEXT, balance INTEGER);
CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, to_addr TEXT, subject TEXT, status TEXT, error TEXT, file TEXT);
`);

const DEFAULT_PRODUCTS = [
  { id: 'platinum-double-mix', number: '01', brand: 'PLATINUM SEVEN', family: 'platinum', flavour: 'Double Mix', series: 'Double Series', accent: '#f54db1', artA: '#4b1680', artB: '#170927', image: '/img/platinum-double-mix.webp', studio: '', real: '/img/platinum-double-mix.webp', description: 'Platinum Seven Double Mix. Original pack photography for the FLAV4 UK collection. One sleeve contains ten packs of twenty.', stock: 0, sort: 1 },
  { id: 'platinum-double-switch', number: '02', brand: 'PLATINUM SEVEN', family: 'platinum', flavour: 'Double Switch', series: 'Double Series', accent: '#af87f2', artA: '#32125c', artB: '#170e38', image: '/img/platinum-double-switch.webp', studio: '', real: '/img/platinum-double-switch.webp', description: 'Platinum Seven Double Switch. Original pack photography for the FLAV4 UK collection. One sleeve contains ten packs of twenty.', stock: 0, sort: 2 },
  { id: 'topgun-iceberry', number: '03', brand: 'TOP GUN', family: 'topgun', flavour: 'Iceberry', series: 'Duo Point', accent: '#28b9ec', artA: '#171451', artB: '#0b1238', image: '/img/topgun-iceberry-real.webp', studio: '', real: '/img/topgun-iceberry-real.webp', description: 'Top Gun Iceberry, pictured in its original product packaging. One sleeve contains ten packs of twenty.', stock: 0, sort: 3 },
  { id: 'topgun-mintberry', number: '04', brand: 'TOP GUN', family: 'topgun', flavour: 'Mint Berry', series: 'Duo Point', accent: '#70b3ae', artA: '#103c55', artB: '#0a172e', image: '/img/topgun-mintberry.webp', studio: '', real: '/img/topgun-mintberry.webp', description: 'Top Gun Mint Berry, pictured in its original product packaging. One sleeve contains ten packs of twenty.', stock: 0, sort: 4 },
];
const DEFAULT_SETTINGS = {
  currency: 'GBP', symbol: '£', price: 60, shipping: 15,
  cutoffHour: 10, timezone: 'Europe/London',
  ownerEmail: process.env.OWNER_EMAIL || '', fromEmail: process.env.FROM_EMAIL || '', fromName: 'FLAV4',
  lowStock: 5, maxPerOrder: 25,
  countries: ['GB'],
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '', telegramChat: process.env.TELEGRAM_CHAT_ID || '',
};
const COUNTRIES = require('./countries.json'); // [{code,name}]
const countryName = code => (COUNTRIES.find(c => c.code === code) || {}).name || code;

const insertProduct = db.prepare(`INSERT OR IGNORE INTO products (id,number,brand,family,flavour,series,accent,artA,artB,image,studio,real,description,stock,sort) VALUES (@id,@number,@brand,@family,@flavour,@series,@accent,@artA,@artB,@image,@studio,@real,@description,@stock,@sort)`);
DEFAULT_PRODUCTS.forEach(p => insertProduct.run(p));
const getSetting = db.prepare('SELECT value FROM settings WHERE key=?');
const putSetting = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
/* One-time UK storefront migration. Existing historical orders and retired stock
   records stay in the database; no inventory is invented for new products. */
const UK_CATALOGUE_REVISION = 'flav4_uk_catalogue_2026_11';
if (!getSetting.get(UK_CATALOGUE_REVISION)) {
  db.transaction(() => {
    const updateProduct = db.prepare(`UPDATE products SET number=@number, brand=@brand, family=@family,
      flavour=@flavour, series=@series, accent=@accent, artA=@artA, artB=@artB, image=@image,
      studio=@studio, real=@real, description=@description, sort=@sort WHERE id=@id`);
    DEFAULT_PRODUCTS.forEach(p => updateProduct.run(p));
    db.prepare("UPDATE products SET active=0 WHERE id IN ('esse-applemint','esse-limewave','topgun-citrusburst')").run();
    const ukSettings = { currency: 'GBP', symbol: '£', price: 60, shipping: 15,
      cutoffHour: 10, timezone: 'Europe/London', countries: ['GB'] };
    for (const [key,value] of Object.entries(ukSettings)) putSetting.run(key, JSON.stringify(value));
    putSetting.run(UK_CATALOGUE_REVISION, JSON.stringify(new Date().toISOString()));
  })();
}

function settings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS)) { const r = getSetting.get(k); if (r) out[k] = JSON.parse(r.value); }
  return out;
}
const now = () => new Date().toISOString();
const money = (n, s) => `${s.symbol}${Number(n).toFixed(2)}`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function publicProducts() {
  return db.prepare('SELECT id,number,brand,family,flavour,series,accent,artA,artB,image,studio,real,description,stock FROM products WHERE active=1 ORDER BY sort').all();
}
function publicSettings() {
  const s = settings();
  return { currency: s.currency, symbol: s.symbol, price: s.price, shipping: s.shipping, cutoffHour: s.cutoffHour, timezone: s.timezone, lowStock: s.lowStock, maxPerOrder: s.maxPerOrder, countries: [{ code: 'GB', name: 'United Kingdom' }] };
}

// ---------- email ----------
function transporter() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 465), secure: String(process.env.SMTP_SECURE || 'true') === 'true', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
}
async function sendMail({ to, subject, html, text }) {
  const s = settings();
  const from = `${s.fromName} <${s.fromEmail || process.env.SMTP_USER || 'orders@flav4.local'}>`;
  const file = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}.html`;
  fs.writeFileSync(path.join(DATA_DIR, 'outbox', file), `<!-- to: ${to} | subject: ${subject} -->\n${html}`);
  const t = transporter();
  const row = { at: now(), to, subject, status: 'saved', error: '', file };
  if (!to) { row.status = 'skipped'; row.error = 'no recipient'; }
  else if (!t) { row.status = 'saved'; row.error = 'SMTP not configured — email saved to outbox only'; }
  else { try { await t.sendMail({ from, to, subject, html, text }); row.status = 'sent'; } catch (e) { row.status = 'failed'; row.error = String(e.message || e); } }
  db.prepare('INSERT INTO outbox (at,to_addr,subject,status,error,file) VALUES (?,?,?,?,?,?)').run(row.at, row.to, row.subject, row.status, row.error, row.file);
  return row;
}
async function sendTelegram(text) {
  const s = settings(); if (!s.telegramToken || !s.telegramChat) return;
  try { await fetch(`https://api.telegram.org/bot${s.telegramToken}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: s.telegramChat, text, parse_mode: 'HTML' }) }); } catch (e) { console.error('telegram', e.message); }
}

const emailShell = (title, body) => `<!doctype html><html><body style="margin:0;background:#0d0623;font-family:Arial,Helvetica,sans-serif;color:#fff"><div style="max-width:620px;margin:0 auto;padding:28px 18px"><div style="font:900 44px/1 'Arial Black',Arial,sans-serif;letter-spacing:-.08em;margin-bottom:22px">FLAV<span style="color:#fa309f">4</span>.</div><div style="background:linear-gradient(150deg,#20104a,#0e0624 55%,#1a0935);border:1px solid #c35dff78;padding:26px 24px"><div style="font:900 11px/1.4 'Courier New',monospace;letter-spacing:.16em;color:#f8aede;margin-bottom:10px">${esc(title)}</div>${body}</div><p style="font:400 11px/1.6 Arial,sans-serif;color:#897ca2;margin-top:18px">FLAV4 · Tracked delivery · 18+ only</p></div></body></html>`;
const addressBlock = o => [o.name, o.address1, o.address2, o.city, o.region, o.postcode, o.country].filter(Boolean).join('\n');
function itemsTable(items, s) {
  return `<table style="width:100%;border-collapse:collapse;margin:16px 0">${items.map(i => `<tr><td style="padding:10px 0;border-bottom:1px solid #745b996a"><div style="font:900 10px/1.4 monospace;letter-spacing:.1em;color:#e8a6f0">${esc(i.brand)} / ${esc(i.series)}</div><div style="font:900 16px/1.2 Arial;margin-top:3px">${esc(i.flavour.toUpperCase())}</div></td><td style="padding:10px 0;border-bottom:1px solid #745b996a;text-align:center;font:900 15px monospace">× ${i.qty}</td><td style="padding:10px 0;border-bottom:1px solid #745b996a;text-align:right;font:900 15px Arial">${money(i.qty * i.price, s)}</td></tr>`).join('')}</table>`;
}
function totalsBlock(o, s) {
  return `<div style="font:900 12px/1.6 monospace;letter-spacing:.05em;color:#ccbcdf"><div>PRODUCTS <span style="float:right;color:#fff">${money(o.subtotal, s)}</span></div><div>DELIVERY <span style="float:right;color:#fff">${money(o.shipping, s)}</span></div><div style="border-top:1px solid #b688c077;margin-top:10px;padding-top:10px;font:900 22px Arial;letter-spacing:-.04em;color:#fff">TOTAL <span style="float:right">${money(o.total, s)}</span></div></div>`;
}
async function notifyNewOrder(o, items) {
  const s = settings();
  const count = items.reduce((a, b) => a + b.qty, 0);
  const subject = `NEW ORDER ${o.ref} — ${count} sleeve${count === 1 ? '' : 's'} — ${o.city}, ${o.country}`;
  const ownerHtml = emailShell('NEW ORDER TO POST', `
    <h1 style="font:900 38px/.95 'Arial Black',Arial;letter-spacing:-.07em;margin:0 0 18px">${esc(o.ref)}</h1>
    <div style="background:#ffffff0d;border-left:3px solid #26bff7;padding:14px 16px;margin-bottom:14px"><div style="font:900 10px/1.4 monospace;letter-spacing:.14em;color:#c5acd2;margin-bottom:8px">POST TO</div><pre style="font:900 16px/1.45 Arial;margin:0;white-space:pre-wrap">${esc(addressBlock(o))}</pre></div>
    <div style="font:400 14px/1.7 Arial;color:#d8c5e9"><b style="color:#fff">Email:</b> ${esc(o.email)}<br><b style="color:#fff">Phone:</b> ${esc(o.phone || '—')}${o.notes ? `<br><b style="color:#fff">Customer note:</b> ${esc(o.notes)}` : ''}</div>
    ${itemsTable(items, s)}${totalsBlock(o, s)}
    <div style="margin-top:22px;padding:14px 16px;background:linear-gradient(100deg,#e53fbc,#ff80d1);color:#180a32;font:900 12px/1.5 monospace;letter-spacing:.06em">STATUS: AWAITING PAYMENT · Mark it paid and posted in the FLAV4 admin.</div>`);
  const custHtml = emailShell('ORDER CONFIRMED', `
    <h1 style="font:900 38px/.95 'Arial Black',Arial;letter-spacing:-.07em;margin:0 0 14px">ORDER RECEIVED.</h1>
    <p style="font:400 15px/1.6 Arial;color:#d3c4e5;margin:0 0 6px">Thanks ${esc(o.name.split(' ')[0])}. Your order <b style="color:#fff">${esc(o.ref)}</b> is in. We'll email you payment details shortly, and your tracking number the moment it's on its way.</p>
    ${itemsTable(items, s)}${totalsBlock(o, s)}
    <div style="margin-top:20px;font:400 13px/1.7 Arial;color:#c8b7d8"><div style="font:900 10px/1.4 monospace;letter-spacing:.14em;color:#c5acd2;margin-bottom:6px">DELIVERING TO</div><pre style="font:400 14px/1.5 Arial;margin:0;white-space:pre-wrap;color:#fff">${esc(addressBlock(o))}</pre></div>`);
  const text = `${subject}\n\nPOST TO:\n${addressBlock(o)}\n\nEmail: ${o.email}\nPhone: ${o.phone || '-'}\n${o.notes ? 'Note: ' + o.notes + '\n' : ''}\nITEMS:\n${items.map(i => `${i.qty} x ${i.brand} ${i.flavour} (${money(i.qty * i.price, s)})`).join('\n')}\n\nSubtotal ${money(o.subtotal, s)}\nDelivery ${money(o.shipping, s)}\nTOTAL ${money(o.total, s)}\n\nStatus: awaiting payment`;
  const results = [];
  results.push(await sendMail({ to: s.ownerEmail, subject, html: ownerHtml, text }));
  results.push(await sendMail({ to: o.email, subject: `FLAV4 order ${o.ref} received`, html: custHtml, text: `Thanks ${o.name}. Your FLAV4 order ${o.ref} is in. We'll email payment details shortly.\n\n${items.map(i => `${i.qty} x ${i.brand} ${i.flavour}`).join('\n')}\nTotal ${money(o.total, s)}` }));
  await sendTelegram(`🛍 <b>NEW ORDER ${esc(o.ref)}</b>\n${items.map(i => `${i.qty} × ${esc(i.brand)} ${esc(i.flavour)}`).join('\n')}\n<b>Total ${money(o.total, s)}</b>\n\n${esc(addressBlock(o))}\n${esc(o.email)} · ${esc(o.phone || '')}`);
  // low stock alerts
  const low = db.prepare('SELECT * FROM products WHERE active=1 AND stock<=?').all(s.lowStock);
  if (low.length && s.ownerEmail) {
    const lines = low.map(p => `<div style="font:900 15px Arial;padding:8px 0;border-bottom:1px solid #745b996a">${esc(p.brand)} ${esc(p.flavour.toUpperCase())} <span style="float:right;color:${p.stock === 0 ? '#ff9caf' : '#ffd166'}">${p.stock} LEFT</span></div>`).join('');
    await sendMail({ to: s.ownerEmail, subject: `LOW STOCK — ${low.map(p => p.flavour).join(', ')}`, html: emailShell('RESTOCK NEEDED', `<h1 style="font:900 34px/.95 'Arial Black',Arial;letter-spacing:-.07em;margin:0 0 16px">RUNNING LOW.</h1>${lines}<p style="font:400 13px/1.6 Arial;color:#c8b7d8;margin-top:16px">Top up in the FLAV4 admin → STOCK.</p>`), text: low.map(p => `${p.brand} ${p.flavour}: ${p.stock} left`).join('\n') });
  }
  return results;
}

// ---------- app ----------
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d', index: 'index.html' }));

app.get('/api/catalog', (req, res) => res.json({ products: publicProducts(), settings: publicSettings() }));

// simple per-IP throttle for orders
const hits = new Map();
function throttle(ip) { const t = Date.now(); const arr = (hits.get(ip) || []).filter(x => t - x < 3600e3); arr.push(t); hits.set(ip, arr); return arr.length > 20; }

const nextRef = () => { const n = (db.prepare('SELECT COALESCE(MAX(id),0) AS m FROM orders').get().m || 0) + 1; return 'FLAV4-' + String(n + 1000).padStart(4, '0'); };

app.post('/api/orders', async (req, res) => {
  const ip = req.ip;
  if (throttle(ip)) return res.status(429).json({ error: 'Too many orders from this connection. Try again later.' });
  const b = req.body || {};
  if (b.website) return res.json({ ok: true, ref: 'FLAV4-0000' }); // honeypot
  const s = settings();
  const clean = v => String(v ?? '').trim().slice(0, 200);
  const o = { name: clean(b.name), email: clean(b.email).toLowerCase(), phone: clean(b.phone), country_code: clean(b.country).toUpperCase(), address1: clean(b.address1), address2: clean(b.address2), city: clean(b.city), region: clean(b.region), postcode: clean(b.postcode), notes: String(b.notes ?? '').trim().slice(0, 600) };
  const errors = {};
  if (o.name.length < 2) errors.name = 'Enter your full name.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.email)) errors.email = 'Enter a valid email address.';
  if (o.phone.length < 6) errors.phone = 'Enter a phone number the courier can reach.';
  if (o.country_code !== 'GB') errors.country = 'Delivery is available to UK addresses only.';
  if (o.address1.length < 4) errors.address1 = 'Enter your street address.';
  if (o.city.length < 2) errors.city = 'Enter your town or city.';
  if (!/^(GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/i.test(o.postcode)) errors.postcode = 'Enter a valid UK postcode.';
  if (b.adult !== true) errors.adult = 'You must confirm you are 18 or over.';
  const cart = Array.isArray(b.items) ? b.items : [];
  const items = [];
  for (const it of cart) {
    const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(String(it.id || ''));
    const qty = Math.floor(Number(it.qty));
    if (!p || !(qty > 0)) continue;
    items.push({ id: p.id, brand: p.brand, series: p.series, flavour: p.flavour, qty: Math.min(qty, s.maxPerOrder), price: s.price, stock: p.stock });
  }
  if (!items.length) errors.items = 'Your bag is empty.';
  const short = items.filter(i => i.qty > i.stock);
  if (short.length) errors.items = short.map(i => `${i.brand} ${i.flavour}: only ${i.stock} left`).join('. ');
  if (Object.keys(errors).length) return res.status(400).json({ errors });

  o.country = countryName(o.country_code);
  o.subtotal = items.reduce((a, i) => a + i.qty * i.price, 0);
  o.shipping = s.shipping; o.total = o.subtotal + o.shipping; o.currency = s.currency;
  o.ref = nextRef(); o.created_at = now(); o.status = 'awaiting_payment'; o.ip = ip;
  const cleanItems = items.map(({ stock, ...rest }) => rest);
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO orders (ref,created_at,status,name,email,phone,country,country_code,address1,address2,city,region,postcode,notes,items,subtotal,shipping,total,currency,ip) VALUES (@ref,@created_at,@status,@name,@email,@phone,@country,@country_code,@address1,@address2,@city,@region,@postcode,@notes,@items,@subtotal,@shipping,@total,@currency,@ip)`).run({ ...o, items: JSON.stringify(cleanItems) });
    for (const i of cleanItems) {
      const r = db.prepare('UPDATE products SET stock=stock-?, sold=sold+? WHERE id=? AND stock>=?').run(i.qty, i.qty, i.id, i.qty);
      if (!r.changes) throw new Error(`Not enough stock for ${i.flavour}`);
      const bal = db.prepare('SELECT stock FROM products WHERE id=?').get(i.id).stock;
      db.prepare('INSERT INTO stock_log (at,product_id,change,reason,balance) VALUES (?,?,?,?,?)').run(now(), i.id, -i.qty, 'order ' + o.ref, bal);
    }
  });
  try { tx(); } catch (e) { return res.status(409).json({ errors: { items: e.message } }); }
  res.json({ ok: true, ref: o.ref, total: o.total, symbol: s.symbol });
  notifyNewOrder(o, cleanItems).catch(e => console.error('notify failed', e));
});

// ---------- admin ----------
const sign = v => crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('hex');
const makeToken = () => { const v = String(Date.now()); return v + '.' + sign(v); };
const validToken = t => { if (!t) return false; const [v, sig] = String(t).split('.'); return sig && sign(v) === sig && Date.now() - Number(v) < 30 * 864e5; };
app.post('/api/admin/login', (req, res) => {
  const pw = String((req.body || {}).password || '');
  const ok = pw.length === ADMIN_PASSWORD.length && crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(ADMIN_PASSWORD));
  if (!ok) return res.status(401).json({ error: 'Wrong password.' });
  res.cookie('flav4_admin', makeToken(), { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 30 * 864e5 });
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => { res.clearCookie('flav4_admin'); res.json({ ok: true }); });
const auth = (req, res, next) => validToken(req.cookies.flav4_admin) ? next() : res.status(401).json({ error: 'login' });
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin', 'index.html')));
app.get('/api/admin/me', auth, (req, res) => res.json({ ok: true }));

app.get('/api/admin/overview', auth, (req, res) => {
  const s = settings();
  const orders = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 300').all().map(o => ({ ...o, items: JSON.parse(o.items) }));
  const products = db.prepare("SELECT * FROM products WHERE id IN ('platinum-double-mix','platinum-double-switch','topgun-iceberry','topgun-mintberry') ORDER BY sort").all();
  const log = db.prepare('SELECT * FROM stock_log ORDER BY id DESC LIMIT 40').all();
  const outbox = db.prepare('SELECT * FROM outbox ORDER BY id DESC LIMIT 40').all();
  const stats = {
    awaiting: orders.filter(o => o.status === 'awaiting_payment').length,
    toPost: orders.filter(o => o.status === 'paid').length,
    posted: orders.filter(o => o.status === 'posted').length,
    revenue: orders.filter(o => ['paid', 'posted'].includes(o.status)).reduce((a, o) => a + o.total, 0),
  };
  res.json({ settings: { ...s, telegramToken: s.telegramToken ? '••••' : '' }, smtp: !!process.env.SMTP_HOST, orders, products, log, outbox, stats, countriesAll: COUNTRIES.filter(c => c.code === 'GB') });
});
app.post('/api/admin/orders/:id/status', auth, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(Number(req.params.id));
  if (!o) return res.status(404).json({ error: 'not found' });
  const { status, tracking } = req.body || {};
  if (!['awaiting_payment', 'paid', 'posted', 'cancelled'].includes(status)) return res.status(400).json({ error: 'bad status' });
  const tx = db.transaction(() => {
    if (status === 'cancelled' && o.status !== 'cancelled') {
      for (const i of JSON.parse(o.items)) { db.prepare('UPDATE products SET stock=stock+?, sold=sold-? WHERE id=?').run(i.qty, i.qty, i.id); const bal = db.prepare('SELECT stock FROM products WHERE id=?').get(i.id).stock; db.prepare('INSERT INTO stock_log (at,product_id,change,reason,balance) VALUES (?,?,?,?,?)').run(now(), i.id, i.qty, 'cancelled ' + o.ref, bal); }
    }
    if (status !== 'cancelled' && o.status === 'cancelled') {
      for (const i of JSON.parse(o.items)) { db.prepare('UPDATE products SET stock=stock-?, sold=sold+? WHERE id=?').run(i.qty, i.qty, i.id); const bal = db.prepare('SELECT stock FROM products WHERE id=?').get(i.id).stock; db.prepare('INSERT INTO stock_log (at,product_id,change,reason,balance) VALUES (?,?,?,?,?)').run(now(), i.id, -i.qty, 'reinstated ' + o.ref, bal); }
    }
    db.prepare('UPDATE orders SET status=?, tracking=COALESCE(?,tracking), paid_at=CASE WHEN ?=\'paid\' AND paid_at IS NULL THEN ? ELSE paid_at END, posted_at=CASE WHEN ?=\'posted\' THEN ? ELSE posted_at END WHERE id=?').run(status, tracking ? String(tracking).slice(0, 80) : null, status, now(), status, now(), o.id);
  });
  tx();
  const fresh = db.prepare('SELECT * FROM orders WHERE id=?').get(o.id);
  if (status === 'posted' && fresh.tracking && fresh.tracking !== o.tracking) {
    const s = settings();
    sendMail({ to: fresh.email, subject: `FLAV4 order ${fresh.ref} is on its way`, html: emailShell('ON ITS WAY', `<h1 style="font:900 38px/.95 'Arial Black',Arial;letter-spacing:-.07em;margin:0 0 14px">DISPATCHED.</h1><p style="font:400 15px/1.6 Arial;color:#d3c4e5">Your order <b style="color:#fff">${esc(fresh.ref)}</b> has been dispatched.</p><div style="margin-top:14px;padding:16px;border:1px solid #8072bb80;border-left:3px solid #26bff7"><div style="font:900 10px/1.4 monospace;letter-spacing:.14em;color:#c5acd2">TRACKING NUMBER</div><div style="font:900 24px/1.2 Arial;letter-spacing:.04em;margin-top:6px">${esc(fresh.tracking)}</div></div>`), text: `Your FLAV4 order ${fresh.ref} has been dispatched. Tracking: ${fresh.tracking}` }).catch(() => {});
    void s;
  }
  res.json({ ok: true, order: { ...fresh, items: JSON.parse(fresh.items) } });
});
app.post('/api/admin/stock/:id', auth, (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const { change, set, reason } = req.body || {};
  let next = p.stock;
  if (set !== undefined) next = Math.max(0, Math.floor(Number(set)));
  else next = Math.max(0, p.stock + Math.floor(Number(change || 0)));
  db.prepare('UPDATE products SET stock=? WHERE id=?').run(next, p.id);
  db.prepare('INSERT INTO stock_log (at,product_id,change,reason,balance) VALUES (?,?,?,?,?)').run(now(), p.id, next - p.stock, String(reason || (set !== undefined ? 'stock count' : 'restock')).slice(0, 60), next);
  res.json({ ok: true, stock: next });
});
app.post('/api/admin/products/:id', auth, (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const { active, description } = req.body || {};
  if (active !== undefined) db.prepare('UPDATE products SET active=? WHERE id=?').run(active ? 1 : 0, p.id);
  if (description !== undefined) db.prepare('UPDATE products SET description=? WHERE id=?').run(String(description).slice(0, 400), p.id);
  res.json({ ok: true });
});
app.post('/api/admin/settings', auth, (req, res) => {
  const b = req.body || {}; const cur = settings();
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const out = {
    currency: 'GBP', symbol: '£',
    price: num(b.price, cur.price), shipping: num(b.shipping, cur.shipping), cutoffHour: 10,
    timezone: 'Europe/London', ownerEmail: String(b.ownerEmail ?? cur.ownerEmail).trim().slice(0, 120), fromEmail: String(b.fromEmail ?? cur.fromEmail).trim().slice(0, 120), fromName: String(b.fromName || cur.fromName).slice(0, 60),
    lowStock: Math.max(0, Math.floor(num(b.lowStock, cur.lowStock))), maxPerOrder: Math.max(1, Math.floor(num(b.maxPerOrder, cur.maxPerOrder))),
    countries: ['GB'],
    telegramToken: b.telegramToken && b.telegramToken !== '••••' ? String(b.telegramToken).trim() : cur.telegramToken, telegramChat: String(b.telegramChat ?? cur.telegramChat).trim(),
  };
  try { new Intl.DateTimeFormat('en-GB', { timeZone: out.timezone }); } catch { return res.status(400).json({ error: 'Unknown timezone' }); }
  for (const [k, v] of Object.entries(out)) putSetting.run(k, JSON.stringify(v));
  res.json({ ok: true, settings: { ...out, telegramToken: out.telegramToken ? '••••' : '' } });
});
app.post('/api/admin/test-email', auth, async (req, res) => {
  const s = settings();
  const r = await sendMail({ to: s.ownerEmail, subject: 'FLAV4 test email', html: emailShell('TEST', `<h1 style="font:900 34px/.95 'Arial Black',Arial;letter-spacing:-.07em;margin:0">IT WORKS.</h1><p style="font:400 14px/1.6 Arial;color:#d3c4e5">Order emails will land here.</p>`), text: 'FLAV4 test email. Order emails will land here.' });
  res.json(r);
});
app.get('/api/admin/outbox/:file', auth, (req, res) => {
  const f = path.basename(req.params.file); const p = path.join(DATA_DIR, 'outbox', f);
  if (!fs.existsSync(p)) return res.status(404).end();
  res.type('html').send(fs.readFileSync(p, 'utf8'));
});

app.listen(PORT, () => console.log(`FLAV4 running on http://localhost:${PORT}  (admin: /admin)`));
