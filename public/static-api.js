// Static-hosting API shim.
//
// The app was written against the little Node proxy in server.js (`/api/gp`,
// `/api/launches`, …). Every upstream it proxies — CelesTrak, Launch Library 2,
// NASA Images and Open-Meteo — sends `Access-Control-Allow-Origin: *`, so the
// browser can call them directly. This file intercepts `fetch('/api/…')` and
// answers it client-side with the exact same response shapes, which lets the
// whole app run from static hosting (GitHub Pages) with no server at all.
//
// Responses are cached in localStorage (with the same TTLs the server used,
// longer for TLEs) so reloads don't hammer the upstream services.

(function () {
  const realFetch = window.fetch.bind(window);

  const ALLOWED_GROUPS = new Set([
    'stations', 'starlink', 'gps-ops', 'weather', 'science', 'geo', 'active', 'noaa', 'amateur',
  ]);
  const LAUNCH_BASE = 'https://lldev.thespacedevs.com/2.3.0/launches';

  const MIN = 60 * 1000;
  const TTL = {
    gp: 60 * MIN,        // CelesTrak asks clients not to re-download the same group too often
    launches: 15 * MIN,
    launch: 15 * MIN,
    media: 24 * 60 * MIN,
    weather: 10 * MIN,
  };

  // ---------- cache (memory + localStorage, both best-effort) ----------

  const mem = new Map();
  const LS_PREFIX = 'orbitus-api:';

  // Returns a fresh entry, or with `allowStale` any entry at all — used as a
  // fallback when the upstream refuses (CelesTrak 403s repeat downloads).
  function cacheGet(key, ttl, allowStale) {
    const fresh = (e) => e && (allowStale || Date.now() - e.time < ttl);
    const hit = mem.get(key);
    if (fresh(hit)) return hit;
    try {
      const raw = localStorage.getItem(LS_PREFIX + key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (fresh(parsed)) { mem.set(key, parsed); return parsed; }
      }
    } catch (e) { /* storage unavailable */ }
    return null;
  }

  function cacheSet(key, value) {
    const entry = { time: Date.now(), value };
    mem.set(key, entry);
    try {
      localStorage.setItem(LS_PREFIX + key, JSON.stringify(entry));
    } catch (e) {
      // Quota (Starlink TLEs are big) — evict our other entries and retry once
      try {
        Object.keys(localStorage).filter((k) => k.startsWith(LS_PREFIX)).forEach((k) => localStorage.removeItem(k));
        localStorage.setItem(LS_PREFIX + key, JSON.stringify(entry));
      } catch (e2) { /* memory cache only */ }
    }
    return entry;
  }

  async function cached(key, ttl, producer) {
    const hit = cacheGet(key, ttl);
    if (hit) return hit;
    try {
      return cacheSet(key, await producer());
    } catch (err) {
      const stale = cacheGet(key, ttl, true);
      if (stale) return stale;
      throw err;
    }
  }

  async function getText(url) {
    const res = await realFetch(url);
    if (!res.ok) throw new Error(`Upstream returned HTTP ${res.status}`);
    return res.text();
  }

  async function getJSON(url) {
    return JSON.parse(await getText(url));
  }

  function httpsify(url) {
    return typeof url === 'string' ? url.replace(/^http:\/\//i, 'https://') : url;
  }

  // ---------- transforms (mirrors server.js) ----------

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
      padLat: l.pad && l.pad.latitude != null ? parseFloat(l.pad.latitude) : null,
      padLon: l.pad && l.pad.longitude != null ? parseFloat(l.pad.longitude) : null,
      location: l.pad && l.pad.location && l.pad.location.name,
      mission: l.mission && l.mission.name,
      missionType: l.mission && l.mission.type,
      orbit: l.mission && l.mission.orbit && l.mission.orbit.name,
      image: (l.image && (l.image.thumbnail_url || l.image.image_url)) || null,
    };
  }

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
    const lsp = l.launch_service_provider;

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
      provider: lsp && lsp.name,
      providerAbbrev: lsp && lsp.abbrev,
      providerType: lsp && lsp.type && lsp.type.name,
      providerCountry: lsp && Array.isArray(lsp.country) ? lsp.country.map((c) => c.name).join(', ') : null,
      providerStats: lsp ? {
        total: lsp.total_launch_count,
        success: lsp.successful_launches,
        failed: lsp.failed_launches,
        consecutive: lsp.consecutive_successful_launches,
        landings: lsp.successful_landings,
      } : null,

      rocket: cfg.full_name || cfg.name,
      rocketFamily: Array.isArray(cfg.families) ? cfg.families.map((f) => f.name).join(' / ') : null,
      rocketDescription: cfg.description || null,
      rocketWiki: cfg.wiki_url || null,
      rocketInfo: cfg.info_url || null,
      rocketImage: (cfg.image && (cfg.image.thumbnail_url || cfg.image.image_url)) || null,
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

      image: (l.image && (l.image.thumbnail_url || l.image.image_url)) || null,
      patches: Array.isArray(l.mission_patches)
        ? l.mission_patches.map((p) => ({ name: p.name, url: p.image_url })) : [],
      programs: Array.isArray(l.program)
        ? l.program.map((p) => ({ name: p.name, description: p.description, wiki: p.wiki_url, image: p.image && p.image.thumbnail_url })) : [],

      timeline: Array.isArray(l.timeline)
        ? l.timeline.map((t) => ({
            abbrev: t.type && t.type.abbrev,
            description: t.type && t.type.description,
            seconds: parseISODuration(t.relative_time),
          })).filter((t) => t.seconds != null).sort((a, b) => a.seconds - b.seconds)
        : [],

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

  function pickVideoRendition(urls) {
    const mp4s = urls.filter((u) => /\.mp4$/i.test(u));
    const order = ['~medium.mp4', '~small.mp4', '~mobile.mp4', '~large.mp4', '~preview.mp4', '~orig.mp4'];
    for (const suffix of order) {
      const hit = mp4s.find((u) => u.toLowerCase().endsWith(suffix));
      if (hit) return httpsify(hit);
    }
    return mp4s.length ? httpsify(mp4s[0]) : null;
  }

  async function resolveVideoAssets(manifestUrl) {
    try {
      const urls = await getJSON(httpsify(encodeURI(manifestUrl)));
      if (!Array.isArray(urls)) return null;
      return {
        videoUrl: pickVideoRendition(urls),
        captionsUrl: httpsify(urls.find((u) => /\.vtt$/i.test(u)) || null),
      };
    } catch (e) {
      return null;
    }
  }

  async function searchMedia(query, mediaType, limitDesc) {
    const url = `https://images-api.nasa.gov/search?q=${encodeURIComponent(query)}&media_type=${mediaType}&page_size=12`;
    const parsed = await getJSON(url);
    const items = (parsed.collection && parsed.collection.items) || [];

    let results = items.slice(0, 8).map((item) => {
      const meta = (item.data && item.data[0]) || {};
      const thumb = (item.links && item.links.find((l) => l.render === 'image')) || (item.links && item.links[0]);
      const description = meta.description || meta.description_508 || null;
      return {
        mediaType,
        title: meta.title || null,
        description: description ? String(description).slice(0, limitDesc) : null,
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
      await Promise.all(results.slice(0, 5).map(async (r) => {
        if (!r.manifestUrl) return;
        const assets = await resolveVideoAssets(r.manifestUrl);
        if (assets) { r.videoUrl = assets.videoUrl; r.captionsUrl = assets.captionsUrl; }
      }));
      results = results.filter((r) => r.videoUrl);
    }
    return results;
  }

  // ---------- route handlers ----------

  const routes = {
    async '/api/gp'(p) {
      const group = p.get('group') || 'stations';
      if (!ALLOWED_GROUPS.has(group)) return [400, { error: `Unknown group "${group}"` }];
      const { time, value } = await cached(`gp:${group}`, TTL.gp, () =>
        getText(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=tle`));
      return [200, { group, updated: time, tle: value }];
    },

    async '/api/launches'(p) {
      const kind = p.get('type') === 'previous' ? 'previous' : 'upcoming';
      const { time, value } = await cached(`launches:${kind}`, TTL.launches, async () => {
        const parsed = await getJSON(`${LAUNCH_BASE}/${kind}/?limit=12&mode=normal`);
        return (parsed.results || []).map(slimLaunch);
      });
      return [200, { kind, updated: time, launches: value }];
    },

    async '/api/launch'(p) {
      const id = (p.get('id') || '').trim();
      if (!/^[a-f0-9-]{20,40}$/i.test(id)) return [400, { error: 'A valid launch "id" is required' }];
      const { time, value } = await cached(`launch:${id}`, TTL.launch, async () =>
        slimLaunchDetail(await getJSON(`${LAUNCH_BASE}/${encodeURIComponent(id)}/?mode=detailed`)));
      return [200, { updated: time, launch: value }];
    },

    async '/api/satimage'(p) {
      const q = (p.get('q') || '').trim();
      if (!q) return [400, { error: 'Missing query parameter "q"' }];
      const { time, value } = await cached(`satimage:${q.toLowerCase()}`, TTL.media, () => searchMedia(q, 'image', 600));
      return [200, { query: q, updated: time, result: value[0] || null, results: value }];
    },

    async '/api/media'(p) {
      const q = (p.get('q') || '').trim();
      const type = p.get('type') === 'video' ? 'video' : 'image';
      if (!q) return [400, { error: 'Missing query parameter "q"' }];
      const { time, value } = await cached(`media:${type}:${q.toLowerCase()}`, TTL.media, () => searchMedia(q, type, 900));
      return [200, { query: q, type, updated: time, results: value }];
    },

    async '/api/weather'(p) {
      const lat = parseFloat(p.get('lat'));
      const lon = parseFloat(p.get('lon'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        return [400, { error: 'Valid "lat" and "lon" query parameters are required' }];
      }
      const { time, value } = await cached(`weather:${lat.toFixed(2)},${lon.toFixed(2)}`, TTL.weather, async () => {
        const params = new URLSearchParams({
          latitude: String(lat),
          longitude: String(lon),
          current: 'temperature_2m,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,weather_code',
          wind_speed_unit: 'kmh',
          timezone: 'UTC',
        });
        const c = (await getJSON(`https://api.open-meteo.com/v1/forecast?${params}`)).current || {};
        return {
          temperatureC: c.temperature_2m ?? null,
          cloudCoverPct: c.cloud_cover ?? null,
          windKmh: c.wind_speed_10m ?? null,
          gustKmh: c.wind_gusts_10m ?? null,
          windDirDeg: c.wind_direction_10m ?? null,
          precipitationMm: c.precipitation ?? null,
          weatherCode: c.weather_code ?? null,
          observedAt: c.time || null,
        };
      });
      return [200, { lat, lon, updated: time, weather: value }];
    },
  };

  function jsonResponse(status, body) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  window.fetch = function (input, init) {
    const raw = typeof input === 'string' ? input : (input && input.url) || '';
    const url = new URL(raw, location.href);
    // Only intercept same-origin /api/* calls; matches both "/api/x" and
    // "<repo-base>/api/x" so it works under a GitHub Pages project path.
    const m = url.origin === location.origin && url.pathname.match(/\/api\/[a-z]+$/);
    const handler = m && routes[m[0]];
    if (!handler) return realFetch(input, init);

    return handler(url.searchParams).then(
      ([status, body]) => jsonResponse(status, body),
      (err) => jsonResponse(502, { error: 'Failed to fetch upstream data', detail: String((err && err.message) || err) }),
    );
  };
})();
