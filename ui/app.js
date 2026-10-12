const API = 'http://localhost:4000/api';
const $ = id => document.getElementById(id);
let token = sessionStorage.getItem('fg_token'), charts = [], map, area = sessionStorage.getItem('fg_area') || 'alappuzha', wiTimer, wiInit = false;
const COLORS = { SAFE: '#2e9e6b', WATCH: '#e0b21a', WARNING: '#f0802a', DANGER: '#e5484d' };
const MSG = { SAFE: 'No flood threat right now. We check every 5 minutes.',
  WATCH: 'Rain is building up. Stay informed and review your evacuation route.',
  WARNING: 'Flooding is likely. Pack your go-bag and be ready to leave. An alert has been sent by SMS and Discord.',
  DANGER: 'Severe flooding expected. Evacuate to higher ground now and call 112 if you need help.' };
const WX = c => c === 0 ? '☀️ Clear' : c < 4 ? '⛅ Partly cloudy' : c < 50 ? '🌫️ Fog' : c < 68 ? '🌧️ Rain' : c < 80 ? '🌦️ Showers' : c < 90 ? '🌧️ Heavy showers' : '⛈️ Thunderstorm';

async function api(path, opts = {}) {
  const r = await fetch(API + path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } });
  if (r.status === 401) { logout(); throw new Error('Session expired'); }
  return r.json();
}
function logout() { if (token) fetch(API + '/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } }).catch(() => {}); sessionStorage.clear(); token = null; $('app').hidden = true; $('login').hidden = false; }

$('loginBtn').onclick = async () => {
  $('loginErr').textContent = '';
  try {
    const r = await fetch(API + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('username').value, password: $('password').value }) });
    const d = await r.json(); if (!r.ok) throw new Error(d.error);
    token = d.token; sessionStorage.setItem('fg_token', token); sessionStorage.setItem('fg_name', d.name); start();
  } catch (e) { $('password').value = ''; $('loginErr').textContent = e.message === 'Failed to fetch' ? 'Cannot reach the server. Start the server first.' : e.message; }
};
$('logout').onclick = logout;
// Make sure the login boxes are empty when the page opens (browsers can auto-fill saved logins after load)
function clearLogin() { $('username').value = ''; $('password').value = ''; }
clearLogin(); setTimeout(clearLogin, 300);
async function start() {
  $('login').hidden = true; $('app').hidden = false;
  renderStatic(); await refresh(); setInterval(refresh, 60000);
}

async function refresh() {
  const [d, h] = await Promise.all([api('/dashboard?area=' + area), api('/history')]);
  const { risk, current: c, daily } = d, col = COLORS[risk.level];
  document.documentElement.style.setProperty('--lvl', col);
  $('fill').style.height = Math.max(risk.score, 4) + '%'; $('score').textContent = risk.score;
  $('levelTxt').textContent = { SAFE: 'Safe', WATCH: 'Watch', WARNING: 'Flood warning', DANGER: 'Flood danger' }[risk.level];
  $('levelMsg').textContent = MSG[risk.level];
  $('facts').innerHTML = `<div><b>${risk.past24} mm</b>rain, last 24h</div><div><b>${risk.next24} mm</b>forecast next 24h (${risk.rangeLabel} ${risk.next24Range[0]}–${risk.next24Range[1]})</div><div><b>${risk.confidence}</b>forecast confidence</div>${risk.ensemble ? `<div><b>${risk.ensemble.prob50}%</b>chance of 50+ mm in 24h</div>` : ''}<div><b>${risk.past72} mm</b>rain, last 72h</div><div><b>${risk.riverSurge}×</b>river flow vs normal</div>`;
  $('upd').innerHTML = `Updated ${new Date(d.updated).toLocaleTimeString()} · average of ${risk.models} weather models${risk.ensemble ? ' plus a ' + risk.ensemble.members + '-member ensemble' : ''} (ECMWF, GFS, ICON). Always compare with the <a href="https://mausam.imd.gov.in" target="_blank" rel="noopener" style="color:#8fc9c2">official IMD warnings</a>.`;
  $('weather').innerHTML = [[c.temperature_2m + '°C', 'Temperature'], [c.apparent_temperature + '°C', 'Feels like'], [c.relative_humidity_2m + '%', 'Humidity'],
    [c.wind_speed_10m + ' km/h', 'Wind'], [c.precipitation + ' mm', 'Rain now'], [Math.round(c.pressure_msl) + ' hPa', 'Pressure']].map(([v, l]) => `<div><b>${v}</b>${l}</div>`).join('');
  const o = d.observed, sg = v => (v > 0 ? '+' : '') + v;
  $('obs').innerHTML = o ? `<b>Ground check, ${o.station} (${o.km} km away, ${o.ageMin ?? '?'} min ago${o.ageMin > 180 ? ', stale' : ''}):</b> ${o.temp}°C (${sg(o.tempDiff)}° vs model)${o.humidity != null ? ', ' + o.humidity + '% humidity' : ''}${o.wind != null ? ', wind ' + o.wind + ' km/h' : ''}${o.pressure ? ', ' + Math.round(o.pressure) + ' hPa' : ''}, ${o.sky}. Real measurement; the airport is not in Alappuzha, and it does not report rainfall amounts.` : 'Ground-station check unavailable right now.';
  const today = c.time.slice(0, 10), ti = daily.time.indexOf(today);
  $('forecast').innerHTML = daily.time.slice(ti + 1, ti + 4).map((t, k) => { const i = ti + 1 + k;
    return `<div><span><b>${new Date(t).toLocaleDateString('en-IN', { weekday: 'long' })}</b><small>${WX(daily.weather_code[i])}</small></span><span style="text-align:right">${Math.round(daily.temperature_2m_max[i])}° / ${Math.round(daily.temperature_2m_min[i])}°<small>${daily.precipitation_sum[i]} mm${daily.precipitation_probability_max[i] != null ? ' · ' + Math.round(daily.precipitation_probability_max[i]) + '%' : ''}</small></span></div>`; }).join('');
  renderExplain(d); renderBanner(d);
  charts.forEach(x => x.destroy());
  charts = [
    new Chart($('rainChart'), { type: 'bar', data: { labels: daily.time.map(t => new Date(t).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })),
      datasets: [{ label: 'Rain (mm)', data: daily.precipitation_sum, backgroundColor: daily.time.map(t => t < today ? '#0f3d42' : t === today ? '#e0b21a' : '#5fd0c4') }] }, options: { plugins: { legend: { display: false } } } }),
    new Chart($('histChart'), { type: 'line', data: { labels: h.map(s => new Date(s.ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit' })),
      datasets: [{ label: 'Risk score', data: h.map(s => s.score), borderColor: col, backgroundColor: col + '33', fill: true, tension: .3, pointRadius: 0 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100 }, x: { ticks: { maxTicksLimit: 6 } } } } })];
  const span = h.length ? ((h[h.length - 1].ts - h[0].ts) / 864e5).toFixed(1) : 0;
  $('histNote').textContent = `${h.length} readings stored (${span} days so far). The server keeps 7 days; the rainfall chart already covers the past 3 days.`;
}

function renderStatic() {
  if ($('numbers').innerHTML) return;
  $('numbers').innerHTML = NUMBERS.map(([n, v]) => `<a href="tel:${v}"><span>${n}</span><b>${v}</b></a>`).join('');
  const acc = o => Object.entries(o).map(([t, l]) => `<details><summary>${t}</summary><ul>${l.map(x => `<li>${x}</li>`).join('')}</ul></details>`).join('');
  $('firstaid').innerHTML = acc(FIRST_AID); $('precautions').innerHTML = acc(PRECAUTIONS);
  map = L.map('map').setView([9.52, 76.37], 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
  SHELTERS.forEach(s => L.marker([s[1], s[2]]).addTo(map).bindPopup('<b>Shelter</b><br>' + s[0]));
  $('routeList').innerHTML = ROUTES.map(r => `<div style="border-color:${r.color}"><b>${r.name}</b>Shelter: ${SHELTERS[r.to][0]}</div>`).join('');
  ROUTES.forEach(async r => {
    const t = SHELTERS[r.to]; let pts = [r.from, [t[1], t[2]]];
    try { // real road geometry from OSRM; falls back to a straight line
      const j = await (await fetch(`https://router.project-osrm.org/route/v1/driving/${r.from[1]},${r.from[0]};${t[2]},${t[1]}?overview=full&geometries=geojson`)).json();
      pts = j.routes[0].geometry.coordinates.map(([x, y]) => [y, x]);
    } catch {}
    L.polyline(pts, { color: r.color, weight: 5, opacity: .85 }).addTo(map).bindPopup(r.name);
    L.circleMarker(r.from, { radius: 7, color: r.color, fillOpacity: 1 }).addTo(map).bindPopup('Start: ' + r.name);
  });
}
function bars(id, ex) {
  const max = Math.max(...ex.parts.map(p => Math.abs(p.points)), 1);
  $(id).innerHTML = ex.parts.map(p => `<div class="bar"><span>${p.label}<small>${p.detail}</small></span><div class="track"><i style="width:${Math.abs(p.points) / max * 100}%;background:${p.points < 0 ? '#2e86ab' : 'var(--lvl)'}"></i></div><b>${p.points > 0 ? '+' : ''}${p.points}</b></div>`).join('');
}
async function whatIf() {
  const q = `area=${area}&next24=${$('s1').value}&past24=${$('s2').value}&surge=${$('s3').value}&past72=${$('s2').value * 1.6}`;
  $('v1').textContent = $('s1').value + ' mm'; $('v2').textContent = $('s2').value + ' mm'; $('v3').textContent = $('s3').value + 'x';
  const ex = await api('/whatif?' + q);
  $('wiOut').innerHTML = `Score ${ex.score}/100 · <span style="color:${COLORS[ex.level]}">${ex.level}</span>`; bars('wiBars', ex);
}
function renderExplain(d) {
  const ex = d.risk.explain;
  $('exSummary').textContent = ex.summary; bars('exBars', ex);
  $('exFlip').textContent = [ex.flip.down, ex.flip.up].filter(Boolean).join(' ') + ' Points show how much each factor adds (or, in blue, removes).';
  if (!$('area').options.length) { $('area').innerHTML = d.areas.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
    $('area').onchange = e => { area = e.target.value; sessionStorage.setItem('fg_area', area); wiInit = false; refresh(); }; }
  $('area').value = d.areaId;
  if (!wiInit) { wiInit = true; $('s1').value = Math.round(d.risk.next24); $('s2').value = Math.round(d.risk.past24); $('s3').value = Math.max(1, d.risk.riverSurge); whatIf();
    ['s1', 's2', 's3'].forEach(k => $(k).oninput = () => { clearTimeout(wiTimer); wiTimer = setTimeout(whatIf, 200); }); }
  const p = d.preset;
  $('preset').innerHTML = `<div><h4>${p.area.name}</h4><p>${p.area.profile}</p><p><b>Elevation:</b> ${p.area.elevation}<br><b>Vulnerability multiplier:</b> ${p.area.mult}x</p></div>
    <div><h4>Past floods</h4><ul>${p.events.map(e => `<li><b>${e.year}</b> ${e.title}. ${e.impact}</li>`).join('')}</ul></div>
    <div><h4>Local factors</h4><ul>${p.notes.map(n => `<li>${n}</li>`).join('')}</ul></div>`;
}
const esc = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function sent(r) { // what happened to each channel: delivered, failed (with reason), or not set up
  if (!r) return '';
  const f = (n, x) => x.simulated ? `${n}: not set up` : `${n}: ${x.sent} of ${x.total} delivered` + (x.errors.length ? ` (${x.errors.join('; ')})` : '');
  return f('SMS', r.sms) + ' · ' + f('Discord', r.discord) + '.';
}
function renderBanner(d) {
  const lines = [], bad = d.risk.level === 'WARNING' || d.risk.level === 'DANGER';
  if (d.demo) lines.push('<b>DEMO MODE:</b> simulated flood data, not real weather.');
  if (bad) lines.push(`<b>⚠ ${d.risk.level} ALERT:</b> flood risk ${d.risk.score}/100 in ${d.preset.area.name}. ` +
    (d.alert.at ? `Alert sent at ${new Date(d.alert.at).toLocaleTimeString()}. ${sent(d.alert.result)}` : 'Alert pending.') +
    (d.alert.text ? `<details><summary>View the alert message</summary><pre class="msg">${esc(d.alert.text)}</pre></details>` : ''));
  $('banner').hidden = !lines.length; $('banner').className = 'banner' + (bad ? ' alert' : '');
  $('banner').innerHTML = lines.map(l => `<div>${l}</div>`).join('');
  $('alertPhone').textContent = 'Signed in as ' + (sessionStorage.getItem('fg_name') || '') + ' · ' + d.targets;
  $('demoBtn').textContent = d.demo ? 'Stop simulation' : 'Simulate flood';
  $('demoBtn').onclick = async () => { await api('/demo', { method: 'POST', body: JSON.stringify({ on: !d.demo }) }); wiInit = false; refresh(); };
}
if (token) start().catch(() => logout());
