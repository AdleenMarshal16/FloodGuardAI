// Preset (non-live) local data for Alappuzha. Values are indicative estimates:
// replace with official KSDMA / survey data to calibrate the model.
const AREAS = {
  alappuzha: { name: 'Alappuzha town', mult: 1.1, elevation: 'about 1 m above sea level',
    profile: 'Canal city; drainage depends on tides and Vembanad Lake levels.' },
  kuttanad: { name: 'Kuttanad (Kainakary, Nedumudi)', mult: 1.3, elevation: '0.6 to 2.2 m below sea level',
    profile: 'Below-sea-level paddy basin where Pamba, Achankovil, Manimala and Meenachil rivers drain. Floods fastest and drains slowest.' },
  ambalappuzha: { name: 'Ambalappuzha', mult: 1.1, elevation: 'about 1 to 2 m above sea level',
    profile: 'Low coastal belt; waterlogging when heavy rain meets high tide.' },
  cherthala: { name: 'Cherthala', mult: 0.9, elevation: 'about 2 to 3 m above sea level',
    profile: 'Slightly higher ground; lower flood exposure but still affected by backwater.' } };

const EVENTS = [
  { year: 2018, title: 'Kerala floods (August)', impact: 'Kuttanad was largely submerged and large-scale evacuations were needed.' },
  { year: 2019, title: 'Monsoon floods (August)', impact: 'Low-lying parts of Kuttanad flooded again.' }];

const NOTES = [
  'Upstream dam releases can raise Kuttanad water levels hours to days after rain falls upstream.',
  'The Thanneermukkom bund and tides control how fast Vembanad Lake drains to the sea.',
  'During the southwest (Jun to Sep) and northeast (Oct to Nov) monsoons, soil and canals are already full, so the same rain does more harm.'];

const seasonOf = d => { const m = d.getMonth() + 1;
  return m >= 6 && m <= 9 ? { name: 'southwest monsoon', mult: 1.1 }
    : m >= 10 && m <= 11 ? { name: 'northeast monsoon', mult: 1.1 } : { name: 'dry season', mult: 1 }; };

// Preset FLOOD scenario (demo): heavy rain for 3 days, more forecast, rivers 4x normal.
// Same shape as the live data, so the real risk model, explanations and SMS alert all run on it.
function demoFlood() {
  const ist = new Date(Date.now() + 19800000);
  const midnight = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  const start = midnight - 3 * 864e5, H = 168;
  const times = Array.from({ length: H }, (_, i) => new Date(start + i * 36e5).toISOString().slice(0, 13) + ':00');
  const nowIdx = 72 + ist.getUTCHours();
  const base = i => { const r = i - nowIdx; return r > 24 ? 2 : r > 0 ? 6 : r > -24 ? 4.5 : r > -72 ? 3 : 1.5; }; // mm per hour
  const series = f => times.map((_, i) => +(base(i) * f).toFixed(2));
  const models = [0.9, 1, 1.15].map(series);
  const precipitation = times.map((_, i) => +(models.reduce((t, m) => t + m[i], 0) / 3).toFixed(2));
  const day = (v, k) => Array.from({ length: 7 }, (_, d) => k(v.slice(d * 24, d * 24 + 24)));
  const sum = a => +a.reduce((x, y) => x + y, 0).toFixed(1), fill = x => Array(7).fill(x);
  return {
    w: { current: { time: times[nowIdx], temperature_2m: 25, relative_humidity_2m: 96, apparent_temperature: 29, precipitation: 7.5,
        wind_speed_10m: 32, pressure_msl: 996, weather_code: 95 },
      hourly: { time: times, precipitation, models },
      daily: { time: day(times, a => a[0].slice(0, 10)), temperature_2m_max: fill(27), temperature_2m_min: fill(24),
        precipitation_sum: day(precipitation, sum), precipitation_probability_max: fill(95), weather_code: fill(65) } },
    f: { daily: { river_discharge: [20, 28, 35, 30, 25], river_discharge_mean: [8, 8, 8, 8, 8] } },
    ens: { time: times, members: Array.from({ length: 20 }, (_, k) => series(0.7 + k * 0.03)) },
    obs: { station: 'Kochi airport (VOCI), DEMO', km: 73, temp: 25, humidity: 95, wind: 30, pressure: 996, ageMin: 8, sky: 'thunderstorm' } };
}

module.exports = { AREAS, EVENTS, NOTES, seasonOf, demoFlood };
