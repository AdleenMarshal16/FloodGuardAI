require('dotenv').config();
const express = require('express'), cors = require('cors'), fs = require('fs'),
  path = require('path'), crypto = require('crypto');

// Node's network errors say only 'fetch failed'; this adds the real cause (e.g. ENOTFOUND, ETIMEDOUT, certificate errors).
const why = e => e && e.cause ? `${e.message} (${e.cause.code || e.cause.message})` : (e && e.message) || String(e);
const app = express(); app.use(cors()); app.use(express.json());

// ---- Config: Alappuzha, Kerala ----
const LAT = 9.4981, LON = 76.3388, PORT = process.env.PORT || 4000;
const HIST_FILE = path.join(__dirname, 'history.json');
const KEEP_DAYS = 7; // history is kept for 7 days (requirement: at least 3)
// Comma-separated list in ALERT_PHONES (e.g. +919..., +919..., +919...). Every number gets each alert.
const PHONES = (process.env.ALERT_PHONES || process.env.ALERT_PHONE || '+910000000000').split(',').map(x => x.trim()).filter(Boolean)
  .filter(x => /^\+\d{8,15}$/.test(x) || (console.warn('Ignoring invalid phone (use +countrycode format):', x), false));
if (!PHONES.length) PHONES.push('+910000000000');

// ---- Auth: only the users listed in users.json (Rohan, Amaya, Adleen) can sign in ----
const USERS_FILE = path.join(__dirname, 'users.json');
const loadUsers = () => { try { return JSON.parse(fs.readFileSync(USERS_FILE)); } catch { return {}; } };
const verifyPassword = (pw, u) => {
  const rec = u || { salt: '00', hash: '00'.repeat(32) }; // dummy record keeps timing similar for unknown users
  const got = crypto.scryptSync(String(pw), Buffer.from(rec.salt, 'hex'), 32), want = Buffer.from(rec.hash, 'hex');
  return !!u && got.length === want.length && crypto.timingSafeEqual(got, want);
};
// Lock a username/chat for 15 minutes after 5 wrong passwords.
const tries = new Map();
const lockedFor = k => { const t = tries.get(k); return t && t.until > Date.now() ? Math.ceil((t.until - Date.now()) / 60000) : 0; };
const failed = k => { const t = tries.get(k) || { n: 0, until: 0 }; t.n++; if (t.n >= 5) { t.until = Date.now() + 15 * 60e3; t.n = 0; } tries.set(k, t); };
const sessions = new Map(); // token -> { user, exp }
const auth = (req, res, next) => {
  const tk = (req.headers.authorization || '').replace('Bearer ', ''), ss = sessions.get(tk);
  if (ss && ss.exp > Date.now()) { req.user = ss.user; return next(); }
  sessions.delete(tk); res.status(401).json({ error: 'Please log in again.' });
};

app.post('/api/login', (req, res) => {
  const name = String((req.body || {}).username || '').trim().toLowerCase(), key = 'web|' + name;
  const wait = lockedFor(key);
  if (wait) return res.status(429).json({ error: `Too many wrong attempts. Try again in ${wait} minutes.` });
  const u = loadUsers()[name];
  if (!verifyPassword((req.body || {}).password || '', u)) { failed(key); return res.status(401).json({ error: 'Username or password is incorrect.' }); }
  tries.delete(key);
  const token = crypto.randomBytes(24).toString('hex'); sessions.set(token, { user: name, exp: Date.now() + 12 * 3600e3 });
  res.json({ token, name: u.name });
});
app.post('/api/logout', auth, (req, res) => { sessions.delete((req.headers.authorization || '').replace('Bearer ', '')); res.json({ ok: true }); });

// ---- Data fetching (Open-Meteo, 3 independent models blended) ----
const MODELS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless'];
const avg = a => { const v = a.filter(x => x != null); return v.length ? +(v.reduce((s, x) => s + x, 0) / v.length).toFixed(2) : null; };

// Averages each value across the models. If a model lacks a value it is skipped.
function blend(raw) {
  const cur = { time: raw.current.time }, hourly = { time: raw.hourly.time }, daily = { time: raw.daily.time };
  for (const k of ['temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'precipitation', 'wind_speed_10m', 'pressure_msl'])
    cur[k] = avg(MODELS.map(m => raw.current[`${k}_${m}`])) ?? raw.current[k];
  cur.weather_code = raw.current[`weather_code_${MODELS[0]}`] ?? raw.current.weather_code;
  hourly.models = MODELS.map(m => raw.hourly[`precipitation_${m}`]).filter(Boolean);
  if (!hourly.models.length && raw.hourly.precipitation) hourly.models = [raw.hourly.precipitation];
  hourly.precipitation = hourly.time.map((_, i) => avg(hourly.models.map(a => a[i])));
  for (const k of ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'precipitation_probability_max'])
    daily[k] = daily.time.map((_, i) => avg(MODELS.map(m => (raw.daily[`${k}_${m}`] || [])[i])) ?? (raw.daily[k] || [])[i] ?? null);
  daily.weather_code = raw.daily[`weather_code_${MODELS[0]}`] || raw.daily.weather_code;
  return { current: cur, hourly, daily };
}

// 51-member ECMWF ensemble: gives real probabilities of heavy rain, not just one number.
async function fetchEnsemble() {
  try {
    const j = await (await fetch(`https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${LAT}&longitude=${LON}` +
      `&hourly=precipitation&models=ecmwf_ifs025&forecast_days=3&timezone=Asia%2FKolkata`)).json();
    const members = Object.keys(j.hourly || {}).filter(k => k.startsWith('precipitation')).map(k => j.hourly[k]);
    return members.length >= 5 ? { time: j.hourly.time, members } : null;
  } catch { return null; }
}
// Real measurement from the nearest airport weather station (Kochi, VOCI): a ground-truth cross-check.
const km = (a, b, c, d) => { const R = 6371, t = x => x * Math.PI / 180, dl = t(c - a), dn = t(d - b);
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dl / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(dn / 2) ** 2)); };
async function fetchObserved() {
  try {
    const m = (await (await fetch('https://aviationweather.gov/api/data/metar?ids=VOCI&format=json')).json())[0];
    if (!m || m.temp == null) return null;
    const rh = m.dewp != null ? Math.round(100 * Math.exp(17.625 * m.dewp / (243.04 + m.dewp)) / Math.exp(17.625 * m.temp / (243.04 + m.temp))) : null;
    const wx = m.wxString || '';
    return { station: 'Kochi airport (VOCI)', km: Math.round(km(LAT, LON, m.lat, m.lon)), temp: m.temp, humidity: rh,
      wind: m.wspd != null ? Math.round(m.wspd * 1.852) : null, pressure: m.altim, ageMin: m.obsTime ? Math.round((Date.now() / 1000 - m.obsTime) / 60) : null,
      sky: /TS/.test(wx) ? 'thunderstorm' : /RA|SH|DZ/.test(wx) ? 'rain' : /FG|BR|HZ/.test(wx) ? 'mist/haze' : wx ? wx : 'no precipitation' };
  } catch { return null; }
}
const compareObs = (o, c) => o && { ...o, tempDiff: +(o.temp - c.temperature_2m).toFixed(1), windDiff: o.wind != null ? Math.round(o.wind - c.wind_speed_10m) : null };

async function fetchData() {
  const wUrl = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&models=${MODELS.join(',')}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,wind_speed_10m,pressure_msl,weather_code` +
    `&hourly=precipitation&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max` +
    `&past_days=3&forecast_days=4&timezone=Asia%2FKolkata`;
  const fUrl = `https://flood-api.open-meteo.com/v1/flood?latitude=${LAT}&longitude=${LON}` +
    `&daily=river_discharge,river_discharge_mean&forecast_days=5`;
  const raw = await (await fetch(wUrl)).json();
  if (raw.error) throw new Error(raw.reason || 'Weather API error');
  const [f, ens, obs] = await Promise.all([
    fetch(fUrl).then(r => r.json()).catch(() => ({})), fetchEnsemble(), fetchObserved()]);
  return { w: blend(raw), f, ens, obs };
}

// ---- Explainable flood risk model ----
// Transparent additive model: every factor adds visible points, so each score can be explained.
// Weather hazard (0-100) is multiplied by the area's preset vulnerability and the season.
const { AREAS, EVENTS, NOTES, seasonOf, demoFlood } = require('./presets');
const DEFAULT_AREA = process.env.ALERT_AREA && AREAS[process.env.ALERT_AREA] ? process.env.ALERT_AREA : 'alappuzha';
const LEVELS = ['SAFE', 'WATCH', 'WARNING', 'DANGER'];
const levelOf = s => s >= 70 ? 'DANGER' : s >= 45 ? 'WARNING' : s >= 25 ? 'WATCH' : 'SAFE';
const r1 = x => +x.toFixed(1);

function core(inp, areaId, date) {
  const area = AREAS[areaId] || AREAS[DEFAULT_AREA], se = seasonOf(date);
  const parts = [
    { key: 'next24', label: 'Forecast rain, next 24h', points: Math.min(inp.next24 / 100, 1) * 40, detail: `${inp.next24} mm (max points at 100 mm)` },
    { key: 'past24', label: 'Rain in the last 24h', points: Math.min(inp.past24 / 100, 1) * 30, detail: `${inp.past24} mm (max points at 100 mm)` },
    { key: 'past72', label: 'Rain in the last 72h', points: Math.min(inp.past72 / 250, 1) * 15, detail: `${inp.past72} mm (max points at 250 mm)` },
    { key: 'river', label: 'River flow above normal', points: Math.min(Math.max(inp.surge - 1, 0) / 2, 1) * 15, detail: `${inp.surge}x normal flow` }];
  const hazard = parts.reduce((t, p) => t + p.points, 0);
  parts.push({ key: 'area', label: 'Area vulnerability (preset)', points: hazard * (area.mult - 1), detail: `${area.name}: ${area.mult}x, ${area.elevation}` });
  parts.push({ key: 'season', label: 'Season (preset)', points: hazard * area.mult * (se.mult - 1), detail: `${se.name}: ${se.mult}x` });
  const score = Math.round(Math.min(Math.max(parts.reduce((t, p) => t + p.points, 0), 0), 100));
  return { parts: parts.map(p => ({ ...p, points: r1(p.points) })), score, level: levelOf(score), area, se };
}

function explain(inp, areaId, date) {
  const c = core(inp, areaId, date);
  const drivers = [...c.parts].filter(p => p.points >= 1).sort((a, b) => b.points - a.points).slice(0, 3)
    .map(p => `${p.label.toLowerCase()} (+${p.points})`).join(', ');
  const preset = c.parts.filter(p => p.key === 'area' || p.key === 'season').reduce((t, p) => t + p.points, 0);
  const summary = `Risk is ${c.level} (${c.score}/100)` + (drivers ? `, driven mainly by ${drivers}.` : ', with little rain or river rise.') +
    (Math.abs(preset) >= 0.5 ? ` Local preset data ${preset > 0 ? 'raises' : 'lowers'} the score by ${r1(Math.abs(preset))} points.` : '');
  // Counterfactuals: how much would forecast rain have to change to move the level?
  const rank = LEVELS.indexOf(c.level); let down = null, up = null;
  for (let x = Math.floor(inp.next24); x >= 0 && down === null; x--)
    if (LEVELS.indexOf(core({ ...inp, next24: x }, areaId, date).level) < rank) down = { rain: x, level: core({ ...inp, next24: x }, areaId, date).level };
  for (let x = Math.ceil(inp.next24) + 1; x <= 400 && up === null; x++)
    if (LEVELS.indexOf(core({ ...inp, next24: x }, areaId, date).level) > rank) up = { rain: x, level: core({ ...inp, next24: x }, areaId, date).level };
  return { score: c.score, level: c.level, parts: c.parts, summary, drivers,
    flip: { down: down && `If forecast rain for the next 24h were ${down.rain} mm or less (now ${inp.next24} mm), the level would drop to ${down.level}.`,
            up: up && `If it rose to ${up.rain} mm or more, the level would rise to ${up.level}.` } };
}

function assess({ w, f, ens }, areaId = DEFAULT_AREA, date = new Date()) {
  const h = w.hourly, nowKey = w.current.time.slice(0, 13);
  let i = h.time.findIndex(t => t.startsWith(nowKey)); if (i < 0) i = h.time.length - 1;
  const sumOf = (arr, a, b) => arr.slice(Math.max(0, a), b).reduce((x, y) => x + (y || 0), 0);
  const past24 = sumOf(h.precipitation, i - 23, i + 1), past72 = sumOf(h.precipitation, i - 71, i + 1),
    modelNext24 = sumOf(h.precipitation, i + 1, i + 25);
  // 1) Agreement between the three models.
  const per = h.models.map(a => sumOf(a, i + 1, i + 25));
  let lo = per.length ? Math.min(...per) : modelNext24, hi = per.length ? Math.max(...per) : modelNext24;
  let confidence = per.length < 2 ? 'Low' : hi - lo <= 10 ? 'High' : hi - lo <= 30 ? 'Medium' : 'Low', next24 = modelNext24;
  // 2) Ensemble: probabilities, a likely range, and a second opinion on the mean.
  let ensemble = null, rangeLabel = 'model range';
  if (ens) {
    let j = ens.time.findIndex(t => t.startsWith(nowKey)); if (j < 0) j = 0;
    const sums = ens.members.map(a => sumOf(a, j + 1, j + 25)).sort((x, y) => x - y), n = sums.length;
    const q = p => sums[Math.min(n - 1, Math.floor(p * n))], share = t => Math.round(100 * sums.filter(x => x >= t).length / n);
    ensemble = { members: n, p10: r1(q(0.1)), p50: r1(q(0.5)), p90: r1(q(0.9)), prob25: share(25), prob50: share(50), prob100: share(100) };
    next24 = (modelNext24 + sums.reduce((x, y) => x + y, 0) / n) / 2; // average of both sources
    const spread = ensemble.p90 - ensemble.p10, ec = spread <= 15 ? 'High' : spread <= 40 ? 'Medium' : 'Low';
    if (['High', 'Medium', 'Low'].indexOf(ec) > ['High', 'Medium', 'Low'].indexOf(confidence)) confidence = ec; // keep the more cautious
    lo = ensemble.p10; hi = ensemble.p90; rangeLabel = 'likely range';
  }
  const d = f.daily; let surge = 1;
  if (d && d.river_discharge) {
    const mean = (d.river_discharge_mean || []).filter(Boolean);
    const avgFlow = mean.length ? mean.reduce((a, b) => a + b, 0) / mean.length : 1;
    surge = Math.max(...d.river_discharge.slice(0, 3).filter(v => v != null)) / (avgFlow || 1);
  }
  const inp = { past24: r1(past24), past72: r1(past72), next24: r1(next24), surge: +surge.toFixed(2) };
  const ex = explain(inp, areaId, date);
  return { score: ex.score, level: ex.level, past24: inp.past24, past72: inp.past72, next24: inp.next24,
    next24Range: [r1(lo), r1(hi)], rangeLabel, ensemble, confidence, models: h.models.length, riverSurge: inp.surge, explain: ex };
}

// ---- History store ----
const loadHist = () => { try { return JSON.parse(fs.readFileSync(HIST_FILE)); } catch { return []; } };
function saveSnapshot(snap) {
  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  let hist = loadHist().filter(s => s.ts > cutoff);
  const last = hist[hist.length - 1];
  if (!last || snap.ts - last.ts > 30 * 60e3) hist.push(snap); // one point per 30 min
  fs.writeFileSync(HIST_FILE, JSON.stringify(hist));
}

// ---- SMS (Twilio REST; simulated if no keys) ----
async function sendSMS(body) {
  const { TWILIO_SID: sid, TWILIO_TOKEN: tok, TWILIO_FROM: from } = process.env;
  if (!sid || !tok || !from) { console.log(`\n[SIMULATED SMS → ${PHONES.join(', ')}]\n${body}\n`); return { simulated: true, total: PHONES.length, sent: 0, errors: [] }; }
  // Send to every registered number at the same time; one failure does not stop the others.
  const results = await Promise.allSettled(PHONES.map(async to => {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: from, Body: body }) });
    const j = await r.json(); if (!j.sid) throw new Error(`${to}: ${j.message || 'send failed'}`);
  }));
  const errors = results.filter(x => x.status === 'rejected').map(x => why(x.reason));
  errors.forEach(e => console.error('SMS failed:', e));
  return { simulated: false, total: PHONES.length, sent: results.length - errors.length, errors };
}

// ---- Discord (free): posts the alert to a channel through a webhook URL, no bot needed ----
// Create one in Discord: channel settings > Integrations > Webhooks > New Webhook > Copy URL.
const DISCORD = (process.env.DISCORD_WEBHOOK_URLS || '').split(',').map(x => x.trim()).filter(Boolean)
  .filter(u => /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(u) || (console.warn('Ignoring invalid Discord webhook URL'), false));
async function sendDiscord(text) {
  if (!DISCORD.length) { console.log(`\n[SIMULATED DISCORD]\n${text}\n`); return { simulated: true, total: 0, sent: 0, errors: [] }; }
  const rs = await Promise.allSettled(DISCORD.map(async (url, i) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'FloodGuardAI', content: text.slice(0, 1900) }) });
    if (!r.ok) throw new Error(`webhook ${i + 1}: Discord replied ${r.status}`);
  }));
  const errors = rs.filter(x => x.status === 'rejected').map(x => why(x.reason)); errors.forEach(e => console.error('Discord failed:', e));
  return { simulated: false, total: DISCORD.length, sent: DISCORD.length - errors.length, errors };
}

// Builds a minimal alert: emergency notice, chance of flood, evacuate to higher ground.
// SMS is plain text (emojis can split a message into extra parts); Discord gets a 🚨 prefix.
function buildAlert(risk, cur, areaName, isDemo) {
  const tag = isDemo ? '[DEMO] ' : '';
  const text = `${tag}EMERGENCY: Chance of flood in ${areaName}. Evacuate to higher ground now. Emergency: 112 / 1077`;
  return { short: text, full: '🚨 ' + text };
}
const sendAlert = async m => {
  const [sms, discord] = await Promise.all([sendSMS(m.short), sendDiscord(m.full)]);
  return { sms, discord };
};
const targets = () => `SMS: ${process.env.TWILIO_SID ? PHONES.length + ' numbers' : 'off'} · Discord: ${DISCORD.length ? DISCORD.length + ' channel(s)' : 'off'}`;

// ---- Monitor loop ----
const RANK = { SAFE: 0, WATCH: 1, WARNING: 2, DANGER: 3 };
let latest = null, lastAlert = { level: 'SAFE', at: 0 };
let demo = process.env.DEMO_MODE === 'flood'; // true = use the preset flood dataset instead of live weather

async function tick() {
  try {
    const data = demo ? demoFlood() : await fetchData(), risk = assess(data, DEFAULT_AREA);
    latest = { updated: Date.now(), risk, data, observed: compareObs(data.obs, data.w.current), current: data.w.current, daily: data.w.daily };
    if (!demo) saveSnapshot({ ts: Date.now(), score: risk.score, level: risk.level,
      temp: data.w.current.temperature_2m, rain: data.w.current.precipitation });
    // Alert on WARNING or above: when level rises, or every 3h while it stays high.
    const worse = RANK[risk.level] > RANK[lastAlert.level];
    const stale = Date.now() - lastAlert.at > 3 * 3600e3;
    if (RANK[risk.level] >= 2 && (worse || stale)) {
      const msg = buildAlert(risk, data.w.current, AREAS[DEFAULT_AREA].name, demo), result = await sendAlert(msg);
      lastAlert = { level: risk.level, at: Date.now(), result, text: msg.full };
    } else if (RANK[risk.level] < 2) lastAlert.level = risk.level;
    console.log(`[${new Date().toLocaleTimeString()}] risk ${risk.level} (${risk.score})`);
  } catch (e) { console.error('Data refresh failed:', e.message); }
}

app.get('/api/dashboard', auth, async (req, res) => {
  if (!latest) await tick();
  if (!latest) return res.status(502).json({ error: 'Weather service unreachable.' });
  const id = AREAS[req.query.area] ? req.query.area : DEFAULT_AREA;
  res.json({ demo, alert: lastAlert, targets: targets(), updated: latest.updated, observed: latest.observed, current: latest.current, daily: latest.daily, risk: assess(latest.data, id),
    areaId: id, areas: Object.entries(AREAS).map(([k, v]) => ({ id: k, name: v.name })),
    preset: { area: AREAS[id], events: EVENTS, notes: NOTES } });
});
// What-if: recompute the explained score from user-chosen inputs.
app.get('/api/whatif', auth, (req, res) => {
  const n = (k, max) => Math.min(Math.max(+req.query[k] || 0, 0), max);
  res.json(explain({ past24: n('past24', 500), past72: n('past72', 800), next24: n('next24', 500), surge: Math.max(+req.query.surge || 1, 0) },
    AREAS[req.query.area] ? req.query.area : DEFAULT_AREA, new Date()));
});
// Turn the preset flood scenario on/off. Turning it on resets the alert memory so the SMS fires right away.
app.post('/api/demo', auth, async (req, res) => { demo = !!(req.body || {}).on; lastAlert = { level: 'SAFE', at: 0 }; await tick(); res.json({ demo }); });
app.get('/api/history', auth, (_q, res) => res.json(loadHist()));

app.listen(PORT, () => { console.log(`FloodGuardAI API → http://localhost:${PORT}`); tick(); });
setInterval(tick, (+process.env.CHECK_MINUTES || 5) * 60e3);