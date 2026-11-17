// Orbit Tracker — tiny zero-dependency Node server.
// Serves the static frontend and proxies CelesTrak TLE data (avoids CORS
// issues and lets us cache so we don't hammer CelesTrak's servers).

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4173;
const PUBLIC_DIR = path.join(__dirname, 'public');
const CACHE_TTL_MS = 5 * 60 * 1000; // CelesTrak TLEs update infrequently; 5 min cache is plenty

// Groups available at https://celestrak.org/NORAD/elements/
const ALLOWED_GROUPS = new Set([
  'stations', 'starlink', 'gps-ops', 'weather', 'science', 'geo', 'active', 'noaa', 'amateur',
]);

const cache = new Map();

function fetchText(url, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'orbit-tracker-local/1.0 (personal project)' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          return fetchText(res.headers.location, redirectsLeft - 1).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Upstream returned HTTP ${res.statusCode}`));
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

async function getGroup(group) {
  const cached = cache.get(group);
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
    return cached;
  }
  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=tle`;
  const text = await fetchText(url);
  const entry = { time: Date.now(), text };
  cache.set(group, entry);
  return entry;
}

// ---------- Launches (TheSpaceDevs Launch Library 2, dev/hobby endpoint) ----------

const LAUNCH_BASE = 'https://lldev.thespacedevs.com/2.3.0/launches';
const LAUNCH_CACHE_TTL_MS = 15 * 60 * 1000; // launch schedules shift; refresh more often than TLEs
const launchCache = new Map();

function slimLaunch(l) {
  return {
    id: l.id,
    name: l.name,
    net: l.net,
    statusName: l.status && l.status.name,
    statusAbbrev: l.status && l.status.abbrev,
    rocket: l.rocket && l.rocket.configuration && l.rocket.configuration.name,
    provider: l.launch_service_provider && l.launch_service_provider.name,
    providerAbbrev: l.launch_service_provider && l.launch_service_provider.abbrev,
    pad: l.pad && l.pad.name,
    padLat: l.pad && typeof l.pad.latitude === 'number' ? l.pad.latitude : (l.pad && l.pad.latitude ? parseFloat(l.pad.latitude) : null),
    padLon: l.pad && typeof l.pad.longitude === 'number' ? l.pad.longitude : (l.pad && l.pad.longitude ? parseFloat(l.pad.longitude) : null),
    location: l.pad && l.pad.location && l.pad.location.name,
    mission: l.mission && l.mission.name,
    missionType: l.mission && l.mission.type,
    orbit: l.mission && l.mission.orbit && l.mission.orbit.name,
    image: l.image && (l.image.thumbnail_url || l.image.image_url) || null,
  };
}

async function getLaunches(kind) {
  const cached = launchCache.get(kind);
  if (cached && Date.now() - cached.time < LAUNCH_CACHE_TTL_MS) {
    return cached;
  }
  const url = `${LAUNCH_BASE}/${kind}/?limit=12&mode=normal`;
  const text = await fetchText(url);
  const parsed = JSON.parse(text);
  const data = (parsed.results || []).map(slimLaunch);
  const entry = { time: Date.now(), data };
  launchCache.set(kind, entry);
  return entry;
}

// ---------- Single launch, full detail ----------
// `mode=detailed` is a very large payload, so we only ask for it one launch
// at a time (when the drawer opens) and slim it down hard. It's worth it:
// this is where the real published mission timeline, booster landing zone
// and vehicle specs live.

const launchDetailCache = new Map();

// "PT2M25S" / "-PT38M" / "P0D" / "PT1H1M46S" -> seconds relative to T-0
function parseISODuration(str) {
  if (!str) return null;
  const neg = str.startsWith('-');
  const m = str.match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?/);
  if (!m) return null;
  const secs = (parseInt(m[1] || 0, 10) * 86400) +
               (parseInt(m[2] || 0, 10) * 3600) +
               (parseInt(m[3] || 0, 10) * 60) +
               (parseFloat(m[4] || 0));
  return neg ? -secs : secs;
}

function slimLaunchDetail(l) {
  const cfg = (l.rocket && l.rocket.configuration) || {};
  const stage = (l.rocket && l.rocket.launcher_stage && l.rocket.launcher_stage[0]) || null;
  const landing = stage && stage.landing;
  const loc = l.pad && l.pad.location;

  return {
    id: l.id,
    name: l.name,
    net: l.net,
    windowStart: l.window_start,
    windowEnd: l.window_end,
    statusName: l.status && l.status.name,
    statusAbbrev: l.status && l.status.abbrev,
    statusDescription: l.status && l.status.description,
    failreason: l.failreason || null,
    provider: l.launch_service_provider && l.launch_service_provider.name,
    providerAbbrev: l.launch_service_provider && l.launch_service_provider.abbrev,
    providerType: l.launch_service_provider && l.launch_service_provider.type && l.launch_service_provider.type.name,
    providerCountry: l.launch_service_provider && Array.isArray(l.launch_service_provider.country)
      ? l.launch_service_provider.country.map((c) => c.name).join(', ') : null,
    providerStats: l.launch_service_provider ? {
      total: l.launch_service_provider.total_launch_count,
      success: l.launch_service_provider.successful_launches,
      failed: l.launch_service_provider.failed_launches,
      consecutive: l.launch_service_provider.consecutive_successful_launches,
      landings: l.launch_service_provider.successful_landings,
    } : null,

    rocket: cfg.full_name || cfg.name,
    rocketFamily: Array.isArray(cfg.families) ? cfg.families.map((f) => f.name).join(' / ') : null,
    rocketDescription: cfg.description || null,
    rocketWiki: cfg.wiki_url || null,
    rocketInfo: cfg.info_url || null,
    rocketImage: cfg.image && (cfg.image.thumbnail_url || cfg.image.image_url) || null,
    specs: {
      lengthM: cfg.length ?? null,
      diameterM: cfg.diameter ?? null,
      launchMassT: cfg.launch_mass ?? null,
      thrustKN: cfg.to_thrust ?? null,
      leoCapacityKg: cfg.leo_capacity ?? null,
      gtoCapacityKg: cfg.gto_capacity ?? null,
      stages: cfg.max_stage ?? null,
      reusable: cfg.reusable ?? null,
      launchCostUsd: cfg.launch_cost ?? null,
      maidenFlight: cfg.maiden_flight ?? null,
      totalLaunches: cfg.total_launch_count ?? null,
      successfulLaunches: cfg.successful_launches ?? null,
      failedLaunches: cfg.failed_launches ?? null,
      successfulLandings: cfg.successful_landings ?? null,
      attemptedLandings: cfg.attempted_landings ?? null,
      fastestTurnaround: cfg.fastest_turnaround ?? null,
    },

    booster: stage && stage.launcher ? {
      serial: stage.launcher.serial_number,
      flightNumber: stage.launcher_flight_number,
      reused: stage.reused,
      flightsTotal: stage.launcher.flights,
      successfulLandings: stage.launcher.successful_landings,
      details: stage.launcher.details,
      previousFlightDate: stage.previous_flight_date,
      turnaround: stage.turn_around_time,
    } : null,

    landing: landing ? {
      attempt: landing.attempt,
      success: landing.success,
      description: landing.description,
      downrangeKm: landing.downrange_distance ?? null,
      zoneName: landing.landing_location && landing.landing_location.name,
      zoneAbbrev: landing.landing_location && landing.landing_location.abbrev,
      zoneLat: landing.landing_location && landing.landing_location.latitude,
      zoneLon: landing.landing_location && landing.landing_location.longitude,
      typeName: landing.type && landing.type.name,
      typeAbbrev: landing.type && landing.type.abbrev,
      typeDescription: landing.type && landing.type.description,
    } : null,

    mission: l.mission && l.mission.name,
    missionType: l.mission && l.mission.type,
    missionDescription: l.mission && l.mission.description,
    orbit: l.mission && l.mission.orbit && l.mission.orbit.name,
    orbitAbbrev: l.mission && l.mission.orbit && l.mission.orbit.abbrev,

    pad: l.pad && l.pad.name,
    padLat: l.pad && l.pad.latitude != null ? parseFloat(l.pad.latitude) : null,
    padLon: l.pad && l.pad.longitude != null ? parseFloat(l.pad.longitude) : null,
    padWiki: l.pad && l.pad.wiki_url,
    padLaunchCount: l.pad && l.pad.total_launch_count,
    location: loc && loc.name,
    timezone: loc && loc.timezone_name,
    locationLaunchCount: loc && loc.total_launch_count,
    country: l.pad && l.pad.country && l.pad.country.name,

    image: l.image && (l.image.thumbnail_url || l.image.image_url) || null,
    patches: Array.isArray(l.mission_patches)
      ? l.mission_patches.map((p) => ({ name: p.name, url: p.image_url })) : [],
    programs: Array.isArray(l.program)
      ? l.program.map((p) => ({ name: p.name, description: p.description, wiki: p.wiki_url, image: p.image && p.image.thumbnail_url })) : [],

    // The star of the show: real published mission events, in seconds from T-0
    timeline: Array.isArray(l.timeline)
      ? l.timeline.map((t) => ({
          abbrev: t.type && t.type.abbrev,
          description: t.type && t.type.description,
          seconds: parseISODuration(t.relative_time),
        })).filter((t) => t.seconds != null).sort((a, b) => a.seconds - b.seconds)
      : [],

    // Official webcast links. `feature_image` is a real thumbnail the feed
    // supplies, which lets us show a preview card when NASA has no
    // public-domain footage of its own for this mission.
    webcasts: Array.isArray(l.vid_urls)
      ? l.vid_urls.map((v) => ({
          title: v.title,
          url: v.url,
          publisher: v.publisher,
          source: v.source,
          live: v.live,
          startTime: v.start_time,
          image: httpsify(v.feature_image || null),
          typeName: v.type && v.type.name,
        })) : [],
    infoUrls: Array.isArray(l.info_urls)
      ? l.info_urls.map((v) => ({ title: v.title, url: v.url, source: v.source })) : [],
    updates: Array.isArray(l.updates)
      ? l.updates.slice(0, 6).map((u) => ({ comment: u.comment, by: u.created_by, on: u.created_on, url: u.info_url })) : [],
    flightClubUrl: l.flightclub_url || null,
  };
}

async function getLaunchDetail(id) {
  const cached = launchDetailCache.get(id);
  if (cached && Date.now() - cached.time < LAUNCH_CACHE_TTL_MS) return cached;
  const text = await fetchText(`${LAUNCH_BASE}/${encodeURIComponent(id)}/?mode=detailed`);
  const data = slimLaunchDetail(JSON.parse(text));
  const entry = { time: Date.now(), data };
  launchDetailCache.set(id, entry);
  return entry;
}

// ---------- Satellite imagery (NASA Image and Video Library — public domain) ----------

const IMAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // photos don't change; cache generously
const imageCache = new Map();

async function searchSatImage(query) {
  const key = query.toLowerCase();
  const cached = imageCache.get(key);
  if (cached && Date.now() - cached.time < IMAGE_CACHE_TTL_MS) {
    return cached;
  }
  const url = `https://images-api.nasa.gov/search?q=${encodeURIComponent(query)}&media_type=image`;
  const text = await fetchText(url);
  const parsed = JSON.parse(text);
  const items = (parsed.collection && parsed.collection.items) || [];

  const results = items.slice(0, 8).map((item) => {
    const meta = (item.data && item.data[0]) || {};
    const thumb = (item.links && item.links.find((l) => l.render === 'image')) || (item.links && item.links[0]);
    const description = meta.description || meta.description_508 || null;
    return {
      title: meta.title || null,
      description: description ? String(description).slice(0, 600) : null,
      dateCreated: meta.date_created || null,
      center: meta.center || null, // which NASA center produced it — used as the credit line
      photographer: meta.photographer || meta.secondary_creator || null,
      nasaId: meta.nasa_id || null,
      thumbnailUrl: thumb ? thumb.href : null,
      sourceUrl: meta.nasa_id ? `https://images.nasa.gov/details/${meta.nasa_id}` : null,
    };
  }).filter((r) => r.thumbnailUrl);

  // `result` (singular) is kept for backwards compatibility with the older
  // single-photo UI path; `results` powers the gallery.
  const entry = { time: Date.now(), results, result: results[0] || null };
  imageCache.set(key, entry);
  return entry;
}

// ---------- Video (NASA Image and Video Library) ----------
// Videos need two hops: the search result gives a `collection.json` manifest
// URL, and that manifest lists the actual playable .mp4 renditions. NASA
// returns those asset URLs as http:// which browsers block as mixed content
// on an https page, so we upgrade them.

const videoCache = new Map();

function httpsify(url) {
  return typeof url === 'string' ? url.replace(/^http:\/\//i, 'https://') : url;
}

function pickVideoRendition(urls) {
  const mp4s = urls.filter((u) => /\.mp4$/i.test(u));
  // Prefer a mid-size rendition — ~orig is often several hundred MB.
  const order = ['~medium.mp4', '~small.mp4', '~mobile.mp4', '~large.mp4', '~preview.mp4', '~orig.mp4'];
  for (const suffix of order) {
    const hit = mp4s.find((u) => u.toLowerCase().endsWith(suffix));
    if (hit) return httpsify(hit);
  }
  return mp4s.length ? httpsify(mp4s[0]) : null;
}

async function resolveVideoAssets(manifestUrl) {
  const cached = videoCache.get(manifestUrl);
  if (cached && Date.now() - cached.time < IMAGE_CACHE_TTL_MS) return cached.data;
  try {
    const text = await fetchText(encodeURI(manifestUrl));
    const urls = JSON.parse(text);
    if (!Array.isArray(urls)) return null;
    const data = {
      videoUrl: pickVideoRendition(urls),
      captionsUrl: httpsify(urls.find((u) => /\.(vtt)$/i.test(u)) || null),
    };
    videoCache.set(manifestUrl, { time: Date.now(), data });
    return data;
  } catch (err) {
    return null;
  }
}

async function searchMedia(query, mediaType) {
  const key = `${mediaType}::${query.toLowerCase()}`;
  const cached = imageCache.get(key);
  if (cached && Date.now() - cached.time < IMAGE_CACHE_TTL_MS) return cached;

  const url = `https://images-api.nasa.gov/search?q=${encodeURIComponent(query)}&media_type=${mediaType}&page_size=12`;
  const text = await fetchText(url);
  const parsed = JSON.parse(text);
  const items = (parsed.collection && parsed.collection.items) || [];

  let results = items.slice(0, 8).map((item) => {
    const meta = (item.data && item.data[0]) || {};
    const thumb = (item.links && item.links.find((l) => l.render === 'image')) || (item.links && item.links[0]);
    const description = meta.description || meta.description_508 || null;
    return {
      mediaType,
      title: meta.title || null,
      description: description ? String(description).slice(0, 900) : null,
      dateCreated: meta.date_created || null,
      center: meta.center || null,
      photographer: meta.photographer || meta.secondary_creator || null,
      keywords: Array.isArray(meta.keywords) ? meta.keywords.slice(0, 8) : [],
      nasaId: meta.nasa_id || null,
      thumbnailUrl: httpsify(thumb ? thumb.href : null),
      manifestUrl: item.href || null,
      sourceUrl: meta.nasa_id ? `https://images.nasa.gov/details/${encodeURIComponent(meta.nasa_id)}` : null,
      videoUrl: null,
    };
  }).filter((r) => r.thumbnailUrl);

  if (mediaType === 'video') {
    // Resolve playable files for the first few only — each is an extra request
    const top = results.slice(0, 5);
    await Promise.all(top.map(async (r) => {
      if (!r.manifestUrl) return;
      const assets = await resolveVideoAssets(r.manifestUrl);
      if (assets) {
        r.videoUrl = assets.videoUrl;
        r.captionsUrl = assets.captionsUrl;
      }
    }));
    results = results.filter((r) => r.videoUrl); // only keep genuinely playable clips
  }

  const entry = { time: Date.now(), results, result: results[0] || null };
  imageCache.set(key, entry);
  return entry;
}

// ---------- Weather (Open-Meteo — free, no key, CC-BY 4.0) ----------

const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000;
const weatherCache = new Map();

async function getWeather(lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = weatherCache.get(key);
  if (cached && Date.now() - cached.time < WEATHER_CACHE_TTL_MS) return cached;

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,weather_code',
    wind_speed_unit: 'kmh',
    timezone: 'UTC',
  });
  const text = await fetchText(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
  const parsed = JSON.parse(text);
  const c = parsed.current || {};

  const data = {
    temperatureC: c.temperature_2m ?? null,
    cloudCoverPct: c.cloud_cover ?? null,
    windKmh: c.wind_speed_10m ?? null,
    gustKmh: c.wind_gusts_10m ?? null,
    windDirDeg: c.wind_direction_10m ?? null,
    precipitationMm: c.precipitation ?? null,
    weatherCode: c.weather_code ?? null,
    observedAt: c.time || null,
  };
  const entry = { time: Date.now(), data };
  weatherCache.set(key, entry);
  return entry;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function serveStatic(req, res) {
  const urlPath = req.url.split('?')[0];
  const relative = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.join(PUBLIC_DIR, decodeURIComponent(relative));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/gp')) {
    const parsed = new URL(req.url, `http://localhost:${PORT}`);
    const group = parsed.searchParams.get('group') || 'stations';

    if (!ALLOWED_GROUPS.has(group)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: `Unknown group "${group}"` }));
    }

    try {
      const { text, time } = await getGroup(group);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ group, updated: time, tle: text }));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch data from CelesTrak', detail: String(err.message || err) }));
    }
    return;
  }

  if (req.url.startsWith('/api/launches')) {
    const parsed = new URL(req.url, `http://localhost:${PORT}`);
    const kind = parsed.searchParams.get('type') === 'previous' ? 'previous' : 'upcoming';

    try {
      const { data, time } = await getLaunches(kind);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ kind, updated: time, launches: data }));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch launch data', detail: String(err.message || err) }));
    }
    return;
  }

  if (req.url.startsWith('/api/satimage')) {
    const parsed = new URL(req.url, `http://localhost:${PORT}`);
    const q = (parsed.searchParams.get('q') || '').trim();

    if (!q) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing query parameter "q"' }));
    }

    try {
      const { result, results, time } = await searchSatImage(q);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ query: q, updated: time, result, results }));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to search NASA image library', detail: String(err.message || err) }));
    }
    return;
  }

  if (req.url.startsWith('/api/launch?') || req.url === '/api/launch') {
    const parsed = new URL(req.url, `http://localhost:${PORT}`);
    const id = (parsed.searchParams.get('id') || '').trim();

    if (!/^[a-f0-9-]{20,40}$/i.test(id)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'A valid launch "id" is required' }));
    }

    try {
      const { data, time } = await getLaunchDetail(id);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ updated: time, launch: data }));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch launch detail', detail: String(err.message || err) }));
    }
    return;
  }

  if (req.url.startsWith('/api/media')) {
    const parsed = new URL(req.url, `http://localhost:${PORT}`);
    const q = (parsed.searchParams.get('q') || '').trim();
    const type = parsed.searchParams.get('type') === 'video' ? 'video' : 'image';

    if (!q) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing query parameter "q"' }));
    }

    try {
      const { results, time } = await searchMedia(q, type);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ query: q, type, updated: time, results }));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to search NASA media library', detail: String(err.message || err) }));
    }
    return;
  }

  if (req.url.startsWith('/api/weather')) {
    const parsed = new URL(req.url, `http://localhost:${PORT}`);
    const lat = parseFloat(parsed.searchParams.get('lat'));
    const lon = parseFloat(parsed.searchParams.get('lon'));

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Valid "lat" and "lon" query parameters are required' }));
    }

    try {
      const { data, time } = await getWeather(lat, lon);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ lat, lon, updated: time, weather: data }));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch weather data', detail: String(err.message || err) }));
    }
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`\nOrbit Tracker running: http://localhost:${PORT}\n(Ctrl+C to stop)\n`);
});
