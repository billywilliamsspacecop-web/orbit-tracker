// weather.js — launch-pad weather via Open-Meteo (free, no key, CC-BY 4.0),
// proxied and cached through our own /api/weather.
//
// The "scrub risk" readout below is our own simple heuristic based on
// published rules-of-thumb (high winds and thick cloud are the usual
// culprits) — it is NOT an official launch-commit criteria evaluation, and
// it's labelled as such wherever it appears.

const weatherClientCache = new Map();
const WEATHER_CLIENT_TTL_MS = 10 * 60 * 1000;

async function fetchWeather(lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = weatherClientCache.get(key);
  if (cached && Date.now() - cached.at < WEATHER_CLIENT_TTL_MS) return cached.data;

  const res = await fetch(`/api/weather?lat=${lat}&lon=${lon}`);
  const payload = await res.json();
  if (!res.ok || payload.error) throw new Error(payload.error || 'weather fetch failed');
  weatherClientCache.set(key, { at: Date.now(), data: payload.weather });
  return payload.weather;
}

function compassFromDeg(deg) {
  if (deg == null) return '—';
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

// Rough, clearly-labelled heuristic — not official launch criteria.
function scrubRisk(w) {
  if (!w) return { level: 'unknown', label: 'Unknown', cls: 'status-tbd' };

  // Absent data must not read as "Favourable" — that would be a confident
  // claim we haven't earned.
  if (w.gustKmh == null && w.windKmh == null && w.cloudCoverPct == null) {
    return { level: 'unknown', label: 'No data', cls: 'status-tbd' };
  }

  let score = 0;
  if (w.gustKmh != null) {
    if (w.gustKmh > 55) score += 3;
    else if (w.gustKmh > 35) score += 2;
    else if (w.gustKmh > 25) score += 1;
  }
  if (w.cloudCoverPct != null) {
    if (w.cloudCoverPct > 85) score += 2;
    else if (w.cloudCoverPct > 60) score += 1;
  }
  if (w.precipitationMm != null && w.precipitationMm > 0.2) score += 2;

  if (score >= 4) return { level: 'high', label: 'Unfavourable', cls: 'status-failure' };
  if (score >= 2) return { level: 'medium', label: 'Marginal', cls: 'status-tbd' };
  return { level: 'low', label: 'Favourable', cls: 'status-success' };
}

function weatherCardHTML(w, placeName) {
  if (!w) return '<div class="detail-empty">Weather unavailable for this location.</div>';
  const risk = scrubRisk(w);
  const cloud = w.cloudCoverPct != null ? Math.round(w.cloudCoverPct) : null;

  return `
    <div class="wx">
      <div class="wx-head">
        <div class="wx-place">${escapeXml(placeName || 'Launch site')}</div>
        <span class="launch-status ${risk.cls}">${risk.label}</span>
      </div>

      ${cloud != null ? `
        <div class="wx-bar-row">
          <span class="wx-bar-label">Cloud cover</span>
          <span class="wx-bar"><span class="wx-bar-fill" style="width:${cloud}%"></span></span>
          <span class="wx-bar-val">${cloud}%</span>
        </div>` : ''}

      <div class="wx-grid">
        <div><span>Wind</span><strong>${w.windKmh != null ? Math.round(w.windKmh) + ' km/h' : '—'}</strong></div>
        <div><span>Gusts</span><strong>${w.gustKmh != null ? Math.round(w.gustKmh) + ' km/h' : '—'}</strong></div>
        <div><span>Direction</span><strong>${compassFromDeg(w.windDirDeg)} ${w.windDirDeg != null ? Math.round(w.windDirDeg) + '°' : ''}</strong></div>
        <div><span>Temp</span><strong>${w.temperatureC != null ? Math.round(w.temperatureC) + '°C' : '—'}</strong></div>
        <div><span>Precip</span><strong>${w.precipitationMm != null ? w.precipitationMm.toFixed(1) + ' mm' : '—'}</strong></div>
        <div><span>Observed</span><strong>${w.observedAt ? escapeXml(w.observedAt.replace('T', ' ')) + 'Z' : '—'}</strong></div>
      </div>

      <div class="meta">Conditions from Open-Meteo. "${risk.label}" is our own rough heuristic from wind, cloud and rain — not official launch-commit criteria.</div>
    </div>
  `;
}

// Renders weather into a container for a given pad, handling its own
// loading/error states so callers can fire-and-forget.
async function renderWeatherInto(containerId, lat, lon, placeName) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (lat == null || lon == null) {
    el.innerHTML = '<div class="detail-empty">No pad coordinates published for this launch.</div>';
    return;
  }
  el.innerHTML = '<div class="detail-empty">Reading conditions…</div>';
  try {
    const w = await fetchWeather(lat, lon);
    el.innerHTML = weatherCardHTML(w, placeName);
  } catch (err) {
    console.error(err);
    el.innerHTML = '<div class="detail-empty">Could not load weather for this site.</div>';
  }
}
