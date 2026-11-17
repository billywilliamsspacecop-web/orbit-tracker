// blueprint.js — ORBITUS blueprint visuals
// Three things live here: the ground-track (trajectory) polyline on the map,
// a generic technical schematic sketch for the selected satellite, and a
// blueprint-style cross-section diagram showing orbital shells.
//
// Relies on globals defined in app.js (map, state, GROUPS, isVisible,
// safePropagate, EARTH_RADIUS_KM) — loaded after app.js, so they exist by
// the time any of these functions actually run.

function escapeXml(str) {
  return String(str).replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  }[c]));
}

function hashAngle(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return (h / 360) * Math.PI * 2;
}

// ---------- Known-object registry ----------
// Recognisable objects get a distinct icon + short label on the map and in the
// dome view, so the famous ones don't disappear into a sea of identical dots.

const KNOWN_OBJECTS = [
  { test: /\bISS\b|ZARYA/i, short: 'ISS', name: 'International Space Station', glyph: '🛰', kind: 'station' },
  { test: /TIANGONG|\bCSS\b/i, short: 'TIANGONG', name: 'Tiangong Space Station', glyph: '🛰', kind: 'station' },
  { test: /HUBBLE|\bHST\b/i, short: 'HUBBLE', name: 'Hubble Space Telescope', glyph: '🔭', kind: 'telescope' },
  { test: /\bJWST\b|WEBB/i, short: 'WEBB', name: 'James Webb Space Telescope', glyph: '🔭', kind: 'telescope' },
  { test: /CREW DRAGON|DRAGON|CARGO DRAGON/i, short: 'DRAGON', name: 'Dragon spacecraft', glyph: '🚀', kind: 'crew' },
  { test: /SOYUZ|PROGRESS/i, short: 'SOYUZ', name: 'Soyuz / Progress vehicle', glyph: '🚀', kind: 'crew' },
  { test: /CYGNUS/i, short: 'CYGNUS', name: 'Cygnus cargo vehicle', glyph: '🚀', kind: 'crew' },
  { test: /GOES/i, short: 'GOES', name: 'GOES weather satellite', glyph: '🌀', kind: 'weather' },
  { test: /NOAA[- ]?\d/i, short: 'NOAA', name: 'NOAA weather satellite', glyph: '🌀', kind: 'weather' },
  { test: /LANDSAT/i, short: 'LANDSAT', name: 'Landsat Earth-imaging satellite', glyph: '🌎', kind: 'earth' },
  { test: /TERRA|AQUA|SUOMI|\bNPP\b|JPSS/i, short: 'EOS', name: 'Earth-observing satellite', glyph: '🌎', kind: 'earth' },
];

function knownObjectFor(name) {
  if (!name) return null;
  return KNOWN_OBJECTS.find((k) => k.test.test(name)) || null;
}

// ---------- Ground track (trajectory) ----------

let groundTrackLayers = [];

function clearGroundTrack() {
  for (const layer of groundTrackLayers) map.removeLayer(layer);
  groundTrackLayers = [];
}

function computeGroundTrackPoints(satrec, centerDate, periodMin) {
  const steps = 72;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const offsetMin = -periodMin / 2 + (periodMin * i) / steps;
    const t = new Date(centerDate.getTime() + offsetMin * 60000);
    const pv = safePropagate(satrec, t);
    if (!pv) continue;
    const gmst = satellite.gstime(t);
    const gd = satellite.eciToGeodetic(pv.position, gmst);
    points.push({
      lat: satellite.degreesLat(gd.latitude),
      lon: satellite.degreesLong(gd.longitude),
      past: offsetMin <= 0,
    });
  }
  return points;
}

function splitTrackSegments(points) {
  const segments = [];
  let current = [];
  let currentPast = null;
  for (const p of points) {
    if (current.length) {
      const prev = current[current.length - 1];
      const jumped = Math.abs(p.lon - prev.lon) > 180; // antimeridian crossing
      if (jumped || p.past !== currentPast) {
        segments.push({ past: currentPast, coords: current });
        current = [];
      }
    }
    if (!current.length) currentPast = p.past;
    current.push(p);
  }
  if (current.length) segments.push({ past: currentPast, coords: current });
  return segments;
}

function updateGroundTrack(sat, now, periodMin) {
  clearGroundTrack();
  const points = computeGroundTrackPoints(sat.satrec, now, periodMin);
  const segments = splitTrackSegments(points);
  const group = GROUPS.find((g) => g.id === sat.groupId);
  const color = group ? group.color : '#ffffff';

  for (const seg of segments) {
    if (seg.coords.length < 2) continue;
    const line = L.polyline(seg.coords.map((p) => [p.lat, p.lon]), {
      color,
      weight: 2,
      opacity: seg.past ? 0.4 : 0.95,
      dashArray: seg.past ? '2 7' : null,
      interactive: false,
    });
    line.addTo(map);
    groundTrackLayers.push(line);
  }
}

// ---------- Satellite schematic (per-satellite "blueprint") ----------

function schematicBodyFor(groupId) {
  if (groupId === 'stations') {
    return `
      <g class="blueprint-svg-line" stroke-width="1.2">
        <rect x="100" y="80" width="60" height="24" rx="3" />
        <line x1="60" y1="92" x2="100" y2="92" />
        <line x1="160" y1="92" x2="200" y2="92" />
        <rect x="30" y="70" width="30" height="44" />
        <rect x="200" y="70" width="30" height="44" />
        <line x1="30" y1="78" x2="60" y2="78" /><line x1="30" y1="86" x2="60" y2="86" />
        <line x1="30" y1="94" x2="60" y2="94" /><line x1="30" y1="102" x2="60" y2="102" />
        <line x1="200" y1="78" x2="230" y2="78" /><line x1="200" y1="86" x2="230" y2="86" />
        <line x1="200" y1="94" x2="230" y2="94" /><line x1="200" y1="102" x2="230" y2="102" />
        <circle cx="130" cy="70" r="6" />
        <line x1="130" y1="64" x2="130" y2="50" />
      </g>`;
  }
  if (groupId === 'starlink') {
    return `
      <g class="blueprint-svg-line" stroke-width="1.2">
        <rect x="95" y="75" width="30" height="50" rx="2" />
        <rect x="125" y="80" width="70" height="40" />
        <line x1="130" y1="88" x2="190" y2="88" /><line x1="130" y1="96" x2="190" y2="96" />
        <line x1="130" y1="104" x2="190" y2="104" /><line x1="130" y1="112" x2="190" y2="112" />
      </g>`;
  }
  if (groupId === 'geo') {
    return `
      <g class="blueprint-svg-line" stroke-width="1.2">
        <rect x="115" y="75" width="30" height="40" rx="2" />
        <rect x="45" y="82" width="65" height="26" />
        <rect x="150" y="82" width="65" height="26" />
        <line x1="50" y1="88" x2="105" y2="88" /><line x1="50" y1="95" x2="105" y2="95" /><line x1="50" y1="102" x2="105" y2="102" />
        <line x1="155" y1="88" x2="210" y2="88" /><line x1="155" y1="95" x2="210" y2="95" /><line x1="155" y1="102" x2="210" y2="102" />
        <path d="M130,75 Q130,55 148,50" />
        <circle cx="150" cy="48" r="7" />
      </g>`;
  }
  // default: body + two panels + dish (GPS, weather, science)
  return `
    <g class="blueprint-svg-line" stroke-width="1.2">
      <rect x="110" y="80" width="40" height="30" rx="3" />
      <rect x="50" y="85" width="55" height="20" />
      <line x1="55" y1="90" x2="100" y2="90" /><line x1="55" y1="95" x2="100" y2="95" /><line x1="55" y1="100" x2="100" y2="100" />
      <rect x="155" y="85" width="55" height="20" />
      <line x1="160" y1="90" x2="205" y2="90" /><line x1="160" y1="95" x2="205" y2="95" /><line x1="160" y1="100" x2="205" y2="100" />
      <circle cx="130" cy="65" r="10" />
      <line x1="130" y1="75" x2="130" y2="80" />
    </g>`;
}

function renderGenericSchematicSVG(sat) {
  const container = document.getElementById('sat-schematic');
  if (!container) return;

  const satrec = sat.satrec;
  const inclDeg = (satrec.inclo * 180) / Math.PI;
  const periodMin = (2 * Math.PI) / satrec.no;
  const group = GROUPS.find((g) => g.id === sat.groupId);
  const groupLabel = group ? group.label : 'Unknown';
  const body = schematicBodyFor(sat.groupId);

  container.innerHTML = `
    <div class="schematic-fallback-note">No verified photo found — showing a generic ${escapeXml(groupLabel.toLowerCase())} schematic instead.</div>
    <svg viewBox="0 0 260 190" xmlns="http://www.w3.org/2000/svg">
      <path class="blueprint-svg-line" d="M6,6 L18,6 M6,6 L6,18" />
      <path class="blueprint-svg-line" d="M254,6 L242,6 M254,6 L254,18" />
      <path class="blueprint-svg-line" d="M6,184 L18,184 M6,184 L6,172" />
      <path class="blueprint-svg-line" d="M254,184 L242,184 M254,184 L254,172" />

      ${body}

      <line class="blueprint-svg-dash" x1="130" y1="20" x2="130" y2="42" />
      <text x="80" y="16" class="blueprint-svg-label">CLASS: ${escapeXml(groupLabel.toUpperCase())}</text>

      <text x="10" y="145" class="blueprint-svg-label">NORAD ${escapeXml(sat.noradId)}</text>
      <text x="188" y="60" class="blueprint-svg-label">INC ${inclDeg.toFixed(1)}°</text>
      <text x="188" y="130" class="blueprint-svg-label">PER ${periodMin.toFixed(0)}m</text>

      <text x="130" y="182" class="blueprint-svg-label" text-anchor="middle">${escapeXml(sat.name)}</text>
    </svg>
  `;
}

// ---------- Real photos (NASA Image and Video Library, public domain) ----------

// Hand-picked search queries for well-known objects, so they reliably hit a
// good match instead of whatever a raw catalog name (e.g. "STARLINK-31245")
// would return.
//
// `exact: true` means the query can only resolve to the actual tracked
// object — there is only one ISS, one Hubble, one Tiangong core module — so
// a NASA photo genuinely depicts what's selected. Everything else here (and
// the raw-name fallback below) is a *family/model* query: it can return a
// photo of the right kind of satellite without it being the specific
// numbered unit currently selected (e.g. "GOES weather satellite" might
// surface GOES-16 when GOES-19 is selected). We show those, because a real
// photo of the actual hardware design is still useful — but we label them
// as reference photos so nobody mistakes it for a picture of that exact
// satellite.
const CURATED_IMAGE_QUERIES = [
  { test: /ISS|ZARYA/i, query: 'International Space Station backdropped by Earth', exact: true },
  { test: /TIANGONG|CSS\b/i, query: 'Tiangong space station', exact: true },
  { test: /HST|HUBBLE/i, query: 'Hubble Space Telescope in orbit', exact: true },
  { test: /GOES/i, query: 'GOES weather satellite', exact: false },
  { test: /NOAA/i, query: 'NOAA weather satellite', exact: false },
  { test: /LANDSAT/i, query: 'Landsat satellite', exact: false },
  { test: /TERRA|AQUA|SUOMI|JPSS|NPP/i, query: 'Earth observing satellite', exact: false },
  { test: /GPS|NAVSTAR/i, query: 'GPS navigation satellite', exact: false },
];

function imageQueryFor(sat) {
  const curated = CURATED_IMAGE_QUERIES.find((c) => c.test.test(sat.name));
  if (curated) return curated;
  // No curated match — searching the raw catalog name against NASA's library
  // essentially never returns a photo of that specific piece of hardware, so
  // this is always treated as a reference (family/generic) result, not exact.
  return { query: `${sat.name} satellite`, exact: false };
}

let schematicRequestToken = 0;

function creditLine(item) {
  const dateStr = item.dateCreated ? new Date(item.dateCreated).getFullYear() : null;
  const bits = ['NASA'];
  if (item.center) bits.push(escapeXml(item.center));
  if (item.photographer) bits.push(escapeXml(item.photographer));
  let line = `Source: ${bits.join(' / ')}`;
  if (dateStr) line += ` · ${dateStr}`;
  line += ' · Public domain';
  return line;
}

// Generic gallery renderer — used for both satellites (sidebar) and rockets
// (detail drawer). Each container keeps its own result set so opening a
// launch drawer doesn't clobber the satellite gallery behind it.
const mediaSets = new Map(); // containerId -> results[]
const mediaTokens = new Map();
const mediaExactFlags = new Map(); // containerId -> whether results are confirmed to be the exact object

function galleryHTML(results, containerId, type, exact) {
  const hero = results[0];
  const isVideo = type === 'video';

  const thumbs = results
    .slice(1, 8)
    .map((r, i) => `
      <button class="media-thumb-btn" data-media-idx="${i + 1}" data-container="${containerId}">
        <img class="media-thumb" src="${escapeXml(r.thumbnailUrl)}" alt="${escapeXml(r.title || '')}" loading="lazy" />
        ${isVideo ? '<span class="thumb-play">▶</span>' : ''}
      </button>`)
    .join('');

  // We can only vouch for a photo actually showing the selected object when
  // the search query was unambiguous (ISS, Hubble, Tiangong). Everything
  // else is a real NASA public-domain photo of the right kind of hardware,
  // but not verifiably *this* tracked unit — say so, right on the image,
  // not buried in fine print.
  const refBadge = exact ? '' : `<div class="media-ref-badge" title="A real public-domain photo of this satellite's type/model — not confirmed to be the exact tracked unit.">REFERENCE PHOTO — same type/model, not this exact unit</div>`;

  return `
    <div class="sat-media">
      <button class="media-hero" data-media-idx="0" data-container="${containerId}" aria-label="Expand">
        <img src="${escapeXml(hero.thumbnailUrl)}" alt="${escapeXml(hero.title || '')}" loading="lazy" />
        <span class="media-expand-hint">${isVideo ? '▶ Play' : '⤢ Expand'}</span>
        ${isVideo ? '<span class="hero-play">▶</span>' : ''}
      </button>
      ${refBadge}
      <div class="sat-photo-title">${escapeXml(hero.title || '')}</div>
      <div class="sat-photo-credit">
        ${creditLine(hero)}
        ${hero.sourceUrl ? ` · <a href="${escapeXml(hero.sourceUrl)}" target="_blank" rel="noopener">View on images.nasa.gov</a>` : ''}
      </div>
      ${thumbs ? `<div class="media-thumbs">${thumbs}</div>` : ''}
      <div class="media-count">${results.length} public-domain ${isVideo ? 'video' : 'image'}${results.length === 1 ? '' : 's'} · click any to open</div>
    </div>
  `;
}

async function renderMediaInto(containerId, query, exact, type, onEmpty) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const token = (mediaTokens.get(containerId) || 0) + 1;
  mediaTokens.set(containerId, token);
  mediaSets.set(containerId, []);

  container.innerHTML = `<div class="schematic-fallback-note">Searching NASA's public ${type === 'video' ? 'video' : 'image'} library…</div>`;

  try {
    const res = await fetch(`/api/media?q=${encodeURIComponent(query)}&type=${type}`);
    const payload = await res.json();
    if (mediaTokens.get(containerId) !== token) return; // superseded by a newer request

    const results = (payload && payload.results) || [];
    if (!res.ok || payload.error || !results.length) {
      if (onEmpty) onEmpty();
      else container.innerHTML = `<div class="schematic-fallback-note">No public-domain ${type === 'video' ? 'video' : 'imagery'} found for “${escapeXml(query)}”.</div>`;
      return;
    }

    mediaSets.set(containerId, results);
    mediaExactFlags.set(containerId, !!exact);
    container.innerHTML = galleryHTML(results, containerId, type, exact);
    container.querySelectorAll('[data-media-idx]').forEach((el) => {
      el.addEventListener('click', () => openMediaModal(containerId, parseInt(el.dataset.mediaIdx, 10)));
    });
  } catch (err) {
    if (mediaTokens.get(containerId) !== token) return;
    console.error(err);
    if (onEmpty) onEmpty();
    else container.innerHTML = '<div class="schematic-fallback-note">Could not reach the media library.</div>';
  }
}

let currentSatellite = null;
let currentSatMediaType = 'image';

function renderSatelliteSchematic(sat) {
  currentSatellite = sat;
  // Diagrams are generated locally from the TLE, so they can render instantly
  if (typeof renderSatelliteDiagrams === 'function') renderSatelliteDiagrams(sat);
  // Reset to photos when a new satellite is picked
  currentSatMediaType = 'image';
  document.querySelectorAll('[data-media]').forEach((b) => {
    b.classList.toggle('active', b.dataset.media === 'image');
  });
  loadSatelliteMedia();
}

function loadSatelliteMedia() {
  if (!currentSatellite) return;
  const sat = currentSatellite;
  const q = imageQueryFor(sat);
  renderMediaInto('sat-schematic', q.query, q.exact, currentSatMediaType, () => {
    // No usable media — fall back to the generic technical schematic, but only
    // for photos (a missing video is not worth replacing with a diagram).
    if (currentSatMediaType === 'image') renderGenericSchematicSVG(sat);
    else document.getElementById('sat-schematic').innerHTML =
      `<div class="schematic-fallback-note">No public-domain video found for this object. Most catalogued satellites have no individual footage.</div>`;
  });
}

// ---------- Media lightbox ----------

let modalContainerId = null;
let modalIndex = 0;

function openMediaModal(containerId, index) {
  const results = mediaSets.get(containerId) || [];
  const item = results[index];
  if (!item) return;

  modalContainerId = containerId;
  modalIndex = index;

  const img = document.getElementById('mm-img');
  const vid = document.getElementById('mm-video');

  if (item.mediaType === 'video' && item.videoUrl) {
    img.hidden = true;
    img.src = '';
    vid.hidden = false;
    vid.src = item.videoUrl;
    vid.poster = item.thumbnailUrl || '';
  } else {
    vid.hidden = true;
    vid.pause();
    vid.removeAttribute('src');
    img.hidden = false;
    img.src = item.thumbnailUrl;
    img.alt = item.title || '';
  }

  document.getElementById('mm-ref-badge').hidden = !!mediaExactFlags.get(containerId);
  document.getElementById('mm-title').textContent = item.title || 'Untitled';
  document.getElementById('mm-desc').textContent = item.description || '';
  document.getElementById('mm-credit').innerHTML =
    creditLine(item) +
    (item.sourceUrl ? ` · <a href="${escapeXml(item.sourceUrl)}" target="_blank" rel="noopener">View original on images.nasa.gov</a>` : '') +
    (item.videoUrl ? ` · <a href="${escapeXml(item.videoUrl)}" target="_blank" rel="noopener">Direct video file</a>` : '');

  const many = results.length > 1;
  document.getElementById('mm-prev').hidden = !many;
  document.getElementById('mm-next').hidden = !many;
  document.getElementById('media-modal').hidden = false;
}

function stepMediaModal(delta) {
  const results = mediaSets.get(modalContainerId) || [];
  if (!results.length) return;
  const next = (modalIndex + delta + results.length) % results.length;
  openMediaModal(modalContainerId, next);
}

function closeMediaModal() {
  document.getElementById('media-modal').hidden = true;
  document.getElementById('mm-img').src = '';
  const vid = document.getElementById('mm-video');
  vid.pause();
  vid.removeAttribute('src');
}

function initMediaModal() {
  document.getElementById('media-modal-close').addEventListener('click', closeMediaModal);
  document.getElementById('media-modal-backdrop').addEventListener('click', closeMediaModal);
  document.getElementById('mm-prev').addEventListener('click', () => stepMediaModal(-1));
  document.getElementById('mm-next').addEventListener('click', () => stepMediaModal(1));

  document.addEventListener('keydown', (e) => {
    if (document.getElementById('media-modal').hidden) return;
    if (e.key === 'Escape') closeMediaModal();
    if (e.key === 'ArrowLeft') stepMediaModal(-1);
    if (e.key === 'ArrowRight') stepMediaModal(1);
  });

  // Photos / Videos switch on the satellite panel
  document.querySelectorAll('[data-media]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-media]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentSatMediaType = btn.dataset.media;
      loadSatelliteMedia();
    });
  });
}

// ---------- Orbital cross-section (blueprint shell diagram) ----------

function renderCrossSection() {
  const container = document.getElementById('cross-section');
  if (!container) return;

  const cx = 150;
  const cy = 150;
  const scale = 140 / (EARTH_RADIUS_KM + 35786); // px per km, GEO pinned to r=140
  const earthR = EARTH_RADIUS_KM * scale;
  const leoR = (EARTH_RADIUS_KM + 2000) * scale;
  const meoR = (EARTH_RADIUS_KM + 20200) * scale;
  const geoR = (EARTH_RADIUS_KM + 35786) * scale;

  let dots = '';
  const visibleGroups = GROUPS.filter((g) => isVisible(g.id));
  for (const g of visibleGroups) {
    const bucket = state.groups.get(g.id);
    const sats = bucket.sats.filter((s) => s.lastAlt != null);
    const base = hashAngle(g.id);
    sats.forEach((s, i) => {
      const angle = base + (i / Math.max(sats.length, 1)) * Math.PI * 2;
      const r = Math.min((EARTH_RADIUS_KM + s.lastAlt) * scale, 148);
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.6" fill="${g.color}" />`;
    });
  }

  container.innerHTML = `
    <svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${cx}" cy="${cy}" r="${geoR.toFixed(1)}" class="blueprint-svg-dash" />
      <circle cx="${cx}" cy="${cy}" r="${meoR.toFixed(1)}" class="blueprint-svg-dash" />
      <circle cx="${cx}" cy="${cy}" r="${leoR.toFixed(1)}" class="blueprint-svg-dash" />
      <circle cx="${cx}" cy="${cy}" r="${earthR.toFixed(1)}" fill="#123063" class="blueprint-svg-line" />
      <line x1="${(cx - earthR).toFixed(1)}" y1="${cy}" x2="${(cx + earthR).toFixed(1)}" y2="${cy}" class="blueprint-svg-line" stroke-width="0.6" />
      <line x1="${cx}" y1="${(cy - earthR).toFixed(1)}" x2="${cx}" y2="${(cy + earthR).toFixed(1)}" class="blueprint-svg-line" stroke-width="0.6" />
      <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${(cy - earthR).toFixed(1)}" class="blueprint-svg-line" stroke-width="1" />
      <text x="${cx + 3}" y="${(cy - earthR / 2).toFixed(1)}" class="blueprint-svg-label">6,378km</text>

      <text x="${cx + 3}" y="${(cy - leoR - 3).toFixed(1)}" class="blueprint-svg-label">LEO &lt;2,000km</text>
      <text x="${cx + 3}" y="${(cy - meoR - 3).toFixed(1)}" class="blueprint-svg-label">MEO ~20,200km</text>
      <text x="${cx + 3}" y="${(cy - geoR - 3).toFixed(1)}" class="blueprint-svg-label">GEO 35,786km</text>

      ${dots}
    </svg>
  `;
}

// ---------- 2.5D Dome view ----------
// A stack of flat "shell" plates viewed at an angle (CSS 3D transforms) —
// Earth's surface as the base plate, then LEO/MEO/GEO/HEO rising and
// tapering above it like a dome. Each satellite's real current lat/lon is
// projected azimuthally onto its altitude shell (longitude -> angle around
// the disc, latitude -> distance from center). It's a schematic diagram, not
// a literal 3D model — same honesty rule as the cross-section view.

const DOME_LAYERS = [
  { id: 'surface', label: 'EARTH SURFACE', z: 0, scale: 1.0, isEarth: true },
  { id: 'leo', label: 'LEO · <2,000km', z: 90, scale: 0.88, altMin: 0, altMax: 2000 },
  { id: 'meo', label: 'MEO · 2,000–35,000km', z: 180, scale: 0.72, altMin: 2000, altMax: 35000 },
  { id: 'geo', label: 'GEO · ~35,786km', z: 270, scale: 0.56, altMin: 35000, altMax: 36500 },
  { id: 'heo', label: 'HEO · >36,500km', z: 360, scale: 0.42, altMin: 36500, altMax: Infinity },
];

// View controls (zoom / tilt), adjusted by the on-screen buttons
const domeView = { zoom: 1, tilt: 58 };

function domeLayerSatellites(layer) {
  const items = [];
  for (const g of GROUPS) {
    if (!isVisible(g.id)) continue;
    const bucket = state.groups.get(g.id);
    for (const s of bucket.sats) {
      if (s.lastAlt == null || s.lastLat == null || s.lastLon == null) continue;
      if (s.lastAlt >= layer.altMin && s.lastAlt < layer.altMax) items.push({ sat: s, color: g.color });
    }
  }
  return items;
}

const DOME_SIZE = 360;
const DOME_C = DOME_SIZE / 2;
const DOME_R = DOME_SIZE / 2 - 12;

// A tiny off-center highlight + a matching shadow crescent on every dot is
// enough to read as "a lit little sphere" rather than a flat paint chip,
// without needing per-color SVG gradients for a swarm that can run into the
// hundreds.
function sphereDot(x, y, r, color, selected) {
  const hi = `<ellipse cx="${(x - r * 0.32).toFixed(1)}" cy="${(y - r * 0.34).toFixed(1)}" rx="${(r * 0.42).toFixed(1)}" ry="${(r * 0.28).toFixed(1)}" fill="#fdf8ec" opacity="0.65" />`;
  const shade = `<path d="M ${x.toFixed(1)} ${(y - r).toFixed(1)} A ${r} ${r} 0 0 1 ${x.toFixed(1)} ${(y + r).toFixed(1)}" fill="#251f14" opacity="0.16" />`;
  const ring = selected ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r + 3.5).toFixed(1)}" fill="none" stroke="#cd9a3e" stroke-width="1.6" />` : '';
  return `${ring}<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${color}" stroke="#251f14" stroke-width="0.8" />${shade}${hi}`;
}

function domeLayerSVG(layer) {
  if (layer.isEarth) {
    return `
      <svg viewBox="0 0 ${DOME_SIZE} ${DOME_SIZE}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="domeEarthGrad" cx="38%" cy="30%" r="75%">
            <stop offset="0%" stop-color="#f5f1e8" />
            <stop offset="45%" stop-color="#d0e0cd" />
            <stop offset="85%" stop-color="#a0c4a0" />
            <stop offset="100%" stop-color="#6b9d6b" />
          </radialGradient>
        </defs>
        <circle cx="${DOME_C}" cy="${DOME_C}" r="${DOME_R}" fill="url(#domeEarthGrad)" stroke="#1a4d52" stroke-width="2.4" opacity="1" />
        <ellipse cx="${DOME_C - 38}" cy="${DOME_C - 24}" rx="46" ry="26" fill="#2c5a5c" opacity="0.22" />
        <ellipse cx="${DOME_C + 46}" cy="${DOME_C + 30}" rx="36" ry="23" fill="#2c5a5c" opacity="0.22" />
        <ellipse cx="${DOME_C - 8}" cy="${DOME_C + 60}" rx="28" ry="16" fill="#2c5a5c" opacity="0.18" />
        <path d="M ${DOME_C} ${DOME_C - DOME_R} A ${DOME_R} ${DOME_R} 0 0 1 ${DOME_C} ${DOME_C + DOME_R}" fill="#251f14" opacity="0.12" />
        <circle cx="${DOME_C}" cy="${DOME_C}" r="${DOME_R}" fill="none" stroke="#2c5a5c" stroke-width="1.2" stroke-dasharray="4 5" opacity="0.6" />
      </svg>`;
  }

  const sats = domeLayerSatellites(layer);
  let dots = '';
  for (const { sat, color } of sats) {
    const angle = (sat.lastLon * Math.PI) / 180;
    const radiusFrac = 1 - (Math.abs(sat.lastLat) / 90) * 0.8;
    const x = DOME_C + DOME_R * radiusFrac * Math.cos(angle);
    const y = DOME_C + DOME_R * radiusFrac * Math.sin(angle);
    const known = knownObjectFor(sat.name);
    const selected = !!(state.selected && state.selected.noradId === sat.noradId);
    if (known) {
      // Named objects get a labelled, larger, clickable marker so they stand
      // out — and can be picked, unlike the anonymous swarm.
      dots += `
        <g class="dome-sat-dot" data-norad="${escapeXml(sat.noradId)}">
          ${sphereDot(x, y, selected ? 9 : 7, color, selected)}
          <text x="${(x + 10).toFixed(1)}" y="${(y + 3).toFixed(1)}" class="dome-sat-label${selected ? ' selected' : ''}">${escapeXml(known.short)}</text>
        </g>`;
    } else {
      // All satellites are now clickable, not just known ones
      dots += `
        <g class="dome-sat-dot dome-sat-dot-plain" data-norad="${escapeXml(sat.noradId)}">${sphereDot(x, y, selected ? 6 : 3.4, color, selected)}</g>`;
    }
  }

  return `
    <svg viewBox="0 0 ${DOME_SIZE} ${DOME_SIZE}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${DOME_C}" cy="${DOME_C}" r="${DOME_R}" fill="rgba(111,177,255,0.05)" stroke="var(--blueprint-line)" stroke-width="1.2" stroke-dasharray="4 6" opacity="0.65" />
      ${dots}
    </svg>`;
}

// ---------- Dome quick-select (well-known objects only) ----------

function renderDomeObjectList() {
  const el = document.getElementById('dome-object-list');
  if (!el) return;

  const seen = new Map(); // known.short -> sat
  for (const g of GROUPS) {
    if (!isVisible(g.id)) continue;
    for (const s of state.groups.get(g.id).sats) {
      const known = knownObjectFor(s.name);
      if (!known || seen.has(known.short)) continue;
      seen.set(known.short, { sat: s, known });
    }
  }

  if (!seen.size) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.innerHTML = `<div class="dome-list-title">QUICK SELECT</div>` + [...seen.values()].map(({ sat, known }) => {
    const selected = !!(state.selected && state.selected.noradId === sat.noradId);
    return `<button class="dome-list-item${selected ? ' active' : ''}" data-norad="${escapeXml(sat.noradId)}">
      <span class="dome-list-glyph">${known.glyph}</span>${escapeXml(known.short)}
    </button>`;
  }).join('');
}

function initDomeInteraction() {
  const onClick = (e) => {
    const el = e.target.closest('[data-norad]');
    if (!el) return;
    const sat = typeof findSatByNoradId === 'function' ? findSatByNoradId(el.dataset.norad) : null;
    if (sat) selectSatellite(sat);
  };
  const domeView = document.getElementById('dome-view');
  const objectList = document.getElementById('dome-object-list');
  if (domeView) domeView.addEventListener('click', onClick);
  if (objectList) objectList.addEventListener('click', onClick);
  
  // Add mouse drag/spin capability for the dome
  if (domeView) {
    let isDragging = false;
    let dragStartX = 0;
    let dragStartTilt = 0;
    
    domeView.addEventListener('mousedown', (e) => {
      if (e.target.closest('[data-norad]')) return; // Don't drag if clicking on a satellite
      isDragging = true;
      dragStartX = e.clientX;
      dragStartTilt = domeView.tilt || 58;
      domeView.style.cursor = 'grabbing';
      e.preventDefault();
    });
    
    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const deltaX = e.clientX - dragStartX;
      // Tilt range: 20 to 80 degrees, sensitive to drag
      const newTilt = Math.max(20, Math.min(80, dragStartTilt - deltaX * 0.15));
      if (typeof setDomeTilt === 'function') {
        const delta = newTilt - (domeView.tilt || 58);
        if (Math.abs(delta) > 0.1) setDomeTilt(delta);
      }
    });
    
    window.addEventListener('mouseup', () => {
      isDragging = false;
      domeView.style.cursor = 'default';
    });
    
    // Touch drag for mobile
    domeView.addEventListener('touchstart', (e) => {
      if (e.target.closest('[data-norad]')) return;
      isDragging = true;
      dragStartX = e.touches[0].clientX;
      dragStartTilt = domeView.tilt || 58;
      e.preventDefault();
    }, { passive: false });
    
    window.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      const deltaX = e.touches[0].clientX - dragStartX;
      const newTilt = Math.max(20, Math.min(80, dragStartTilt - deltaX * 0.15));
      if (typeof setDomeTilt === 'function') {
        const delta = newTilt - (domeView.tilt || 58);
        if (Math.abs(delta) > 0.1) setDomeTilt(delta);
      }
      e.preventDefault();
    }, { passive: false });
    
    window.addEventListener('touchend', () => {
      isDragging = false;
    });
  }
}

function renderDomeView() {
  const container = document.getElementById('dome-view');
  if (!container) return;

  // Store tilt/zoom on the container for drag handler access
  container.tilt = domeView.tilt;
  container.zoom = domeView.zoom;

  let html = `<div class="dome-layers" style="--dzoom:${domeView.zoom}; --dtilt:${domeView.tilt}deg;">`;
  for (const layer of DOME_LAYERS) {
    const count = layer.isEarth ? null : domeLayerSatellites(layer).length;
    html += `
      <div class="dome-layer" style="--dz:${layer.z}px; --dscale:${layer.scale};">
        <div class="dome-layer-label">${escapeXml(layer.label)}${count !== null ? ` · ${count}` : ''}</div>
        ${domeLayerSVG(layer)}
      </div>`;
  }
  html += '</div>';
  container.innerHTML = html;
  renderDomeObjectList();
}

// ---------- Satellite horizon view ----------
// The launch dome's visual language applied to satellites: a curved Earth
// horizon with real coastlines, satellites plotted above it at their true
// altitude band. Toggles between the Western and Eastern hemisphere, since
// a whole globe doesn't fit this shape.

const HZ_W = 900;
const HZ_H = 460;
const HZ_CY = 2100;
const HZ_R = 1780;

// Full names, not just abbreviations
const HZ_BANDS = [
  { key: 'leo',  abbrev: 'LEO', full: 'Low Earth Orbit',        detail: '160–2,000 km',   y: 300, altMin: 0,     altMax: 2000 },
  { key: 'meo',  abbrev: 'MEO', full: 'Medium Earth Orbit',     detail: '2,000–35,000 km', y: 216, altMin: 2000,  altMax: 35000 },
  { key: 'geo',  abbrev: 'GEO', full: 'Geostationary Orbit',    detail: '~35,786 km',      y: 132, altMin: 35000, altMax: 36500 },
  { key: 'heo',  abbrev: 'HEO', full: 'Highly Elliptical Orbit', detail: '>36,500 km',     y: 58,  altMin: 36500, altMax: Infinity },
];

const horizonView = { hemisphere: 'west' }; // 'west' => Americas, 'east' => Europe/Asia

function hzY(x) {
  const dx = x - HZ_W / 2;
  return HZ_CY - Math.sqrt(Math.max(HZ_R * HZ_R - dx * dx, 0));
}

function hemisphereCenterLon() {
  return horizonView.hemisphere === 'west' ? -90 : 90;
}

function renderSatHorizon() {
  const container = document.getElementById('sat-horizon');
  if (!container) return;

  const centerLon = hemisphereCenterLon();
  const spanLon = 180;

  const coast = coastlinePathData({
    centerLon, spanLon, width: HZ_W, horizonYFn: hzY, bandDepth: 96,
  });

  const horizonPts = [];
  for (let x = 0; x <= HZ_W; x += 6) horizonPts.push(`${x},${hzY(x).toFixed(1)}`);

  // Plot satellites: longitude -> x across the visible hemisphere,
  // altitude -> which band, latitude -> small vertical jitter within the band
  let dots = '';
  let plotted = 0;
  const perBand = { leo: 0, meo: 0, geo: 0, heo: 0 };

  for (const g of GROUPS) {
    if (!isVisible(g.id)) continue;
    const bucket = state.groups.get(g.id);
    for (const s of bucket.sats) {
      if (s.lastAlt == null || s.lastLon == null) continue;

      let dLon = s.lastLon - centerLon;
      while (dLon > 180) dLon -= 360;
      while (dLon < -180) dLon += 360;
      if (Math.abs(dLon) > spanLon / 2) continue; // other side of the world

      const band = HZ_BANDS.find((b) => s.lastAlt >= b.altMin && s.lastAlt < b.altMax);
      if (!band) continue;

      const x = HZ_W / 2 + (dLon / (spanLon / 2)) * (HZ_W / 2);
      const y = band.y + (s.lastLat / 90) * -26;
      perBand[band.key]++;
      plotted++;

      const known = knownObjectFor(s.name);
      if (known) {
        dots += `<g class="hz-known">
          <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.5" fill="${g.color}" stroke="#fff" stroke-width="1.4"/>
          <text x="${(x + 9).toFixed(1)}" y="${(y + 3.5).toFixed(1)}" class="hz-label">${escapeXml(known.short)}</text>
        </g>`;
      } else {
        dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="${g.color}" opacity="0.9"/>`;
      }
    }
  }

  const bands = HZ_BANDS.map((b) => `
    <line x1="0" y1="${b.y}" x2="${HZ_W}" y2="${b.y}" class="dome-band-line" />
    <text x="10" y="${b.y - 6}" class="dome-band-label">${escapeXml(`${b.full} (${b.abbrev}) · ${b.detail}`)} · ${perBand[b.key]} tracked</text>
  `).join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${HZ_W} ${HZ_H}" xmlns="http://www.w3.org/2000/svg">
      ${bands}
      <path d="M0,${hzY(0).toFixed(1)} ${horizonPts.map((p) => 'L' + p).join(' ')} L${HZ_W},${HZ_H} L0,${HZ_H} Z" class="dome-ground" />
      ${coast ? `<path d="${coast}" class="dome-coast" />` : ''}
      <polyline points="${horizonPts.join(' ')}" class="dome-horizon" />
      ${dots}
      <text x="${HZ_W / 2}" y="${HZ_H - 14}" text-anchor="middle" class="dome-hint-text">
        ${horizonView.hemisphere === 'west' ? 'Western hemisphere · 180°W – 0°' : 'Eastern hemisphere · 0° – 180°E'} · ${plotted} objects in view
      </text>
    </svg>
  `;
}

function setHemisphere(which) {
  horizonView.hemisphere = which;
  document.getElementById('hemi-west').classList.toggle('active', which === 'west');
  document.getElementById('hemi-east').classList.toggle('active', which === 'east');
  renderSatHorizon();
}

function setDomeZoom(delta) {
  domeView.zoom = Math.min(3, Math.max(0.5, domeView.zoom + delta));
  renderDomeView();
}

function setDomeTilt(delta) {
  domeView.tilt = Math.min(85, Math.max(15, domeView.tilt + delta));
  renderDomeView();
}

function resetDomeView() {
  domeView.zoom = 1;
  domeView.tilt = 58;
  renderDomeView();
}
