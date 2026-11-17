// Orbit Tracker frontend
// Fetches TLEs (proxied through our local server) and propagates them
// client-side with satellite.js (SGP4) so the map updates smoothly without
// hitting the network every tick.

// `color` is the bold group identity color — used for tab dots, the legend,
// charts, and (reserved) for a satellite's marker once it's selected.
// `light` is a paper-tinted wash of the same hue used for markers at rest,
// so the map doesn't read as a wall of dark ink until something is picked.
// Picked for hue separation first, vintage-palette tone second — six colors
// bunched around navy/teal/rust all read as "the same dark blob" at a
// glance (composition donut, tab dots), so these are spread across the
// wheel (gold, teal, blue, red, plum, moss) instead of clustered in the
// warm-brown range like the rest of the UI.
const GROUPS = [
  { id: 'stations', label: 'Space stations', color: '#b8822c', light: '#dbbf90', cap: 60 },
  { id: 'gps-ops', label: 'GPS', color: '#3f8f8a', light: '#a5c5ba', cap: 60 },
  { id: 'weather', label: 'Weather', color: '#4d74a6', light: '#abb9c7', cap: 60 },
  { id: 'starlink', label: 'Starlink', color: '#b8503f', light: '#dba999', cap: 150 },
  { id: 'science', label: 'Science', color: '#8a5a7a', light: '#c6adb3', cap: 80 },
  { id: 'geo', label: 'Geostationary', color: '#6e8f5c', light: '#bac5a6', cap: 150 },
];

const ALL_TAB = { id: 'all', label: 'All', color: '#251f14' };

const state = {
  groups: new Map(), // id -> { config, sats: [{name, noradId, satrec, marker, lastAlt}], loaded, updated }
  // Multi-select: any number of groups can be shown at once. Starts with
  // everything on, matching the old "All" default.
  activeGroups: new Set(GROUPS.map((g) => g.id)),
  selected: null,
  showTrack: false,
  domeActive: false,
};

for (const g of GROUPS) state.groups.set(g.id, { config: g, sats: [], loaded: false, updated: null });

function isVisible(groupId) {
  return state.activeGroups.has(groupId);
}

// ---------- Map setup (finite, non-repeating world) ----------

const WORLD_BOUNDS = [[-90, -180], [90, 180]];

const map = L.map('map', {
  worldCopyJump: false,
  maxBounds: WORLD_BOUNDS,
  maxBoundsViscosity: 1.0,
  minZoom: 2,
  zoomControl: true,
}).setView([20, 0], 2);

// Two labelling schemes. Esri's light canvas carries English ("World") place
// names; CARTO's light_all labels everything in the local language/script.
// The 🌐 EN button in the map tools swaps between them.
const baseNoLabels = L.tileLayer(
  'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  { attribution: 'Esri, HERE, Garmin, &copy; OpenStreetMap contributors', maxZoom: 16, noWrap: true, bounds: WORLD_BOUNDS }
);

const labelsEnglish = L.tileLayer(
  'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
  { attribution: '', maxZoom: 16, noWrap: true, bounds: WORLD_BOUNDS, pane: 'shadowPane' }
);

const cartoLocal = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  subdomains: 'abcd',
  maxZoom: 19,
  noWrap: true,
  bounds: WORLD_BOUNDS,
});

// Cloud layer, toggled by the ☁ CLOUDS button.
// NASA GIBS true-colour imagery — keyless, public domain, and shows actual
// cloud systems as photographed by MODIS/Terra. GIBS publishes per-day
// mosaics, and today's is often still being assembled, so we ask for
// yesterday's complete pass.
function gibsDate() {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

const cloudLayer = L.tileLayer(
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${gibsDate()}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
  {
    attribution: 'Imagery: NASA EOSDIS GIBS',
    maxZoom: 9,
    maxNativeZoom: 9,
    noWrap: true,
    opacity: 0.55,
    bounds: WORLD_BOUNDS,
  }
);

state.labelsEnglish = true;

function applyBasemap() {
  [baseNoLabels, labelsEnglish, cartoLocal].forEach((l) => { if (map.hasLayer(l)) map.removeLayer(l); });
  if (state.labelsEnglish) {
    baseNoLabels.addTo(map);
    labelsEnglish.addTo(map);
  } else {
    cartoLocal.addTo(map);
  }
}

applyBasemap();

// Radar-style pulse ring around the selected satellite
const selectedRing = L.circle([0, 0], {
  radius: 20000,
  color: '#251f14',
  weight: 2,
  fillOpacity: 0,
  opacity: 0,
  interactive: false,
});
let pulseStart = Date.now();

function animatePulse() {
  if (state.selected) {
    const elapsed = (Date.now() - pulseStart) % 1600;
    const t = elapsed / 1600;
    selectedRing.setRadius(20000 + t * 450000);
    selectedRing.setStyle({ opacity: 0.85 * (1 - t) });
  }
  requestAnimationFrame(animatePulse);
}
requestAnimationFrame(animatePulse);

// ---------- Charts ----------

Chart.defaults.font.family = "'IBM Plex Mono', monospace";

const pieChart = new Chart(document.getElementById('pie-chart'), {
  type: 'doughnut',
  data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderWidth: 0 }] },
  options: {
    responsive: true,
    plugins: {
      legend: { position: 'bottom', labels: { color: '#5b5340', boxWidth: 10, font: { size: 11 } } },
    },
  },
});

const barChart = new Chart(document.getElementById('bar-chart'), {
  type: 'bar',
  data: {
    labels: [
      ['Low Earth', 'Orbit (LEO)', '<2,000 km'],
      ['Medium Earth', 'Orbit (MEO)', '2,000–35,000 km'],
      ['Geostationary', 'Orbit (GEO)', '~35,786 km'],
      ['Highly Elliptical', 'Orbit (HEO)', '>36,500 km'],
    ],
    datasets: [{ data: [0, 0, 0, 0], backgroundColor: '#1f3550', borderRadius: 4 }],
  },
  options: {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#5b5340', font: { size: 10 } }, grid: { color: '#cdb98a' } },
      y: { ticks: { color: '#5b5340' }, grid: { color: '#cdb98a' }, beginAtZero: true },
    },
  },
});

// ---------- TLE parsing ----------

function parseTLE(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const sats = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i].trim();
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    if (!line1 || !line2 || line1[0] !== '1' || line2[0] !== '2') continue;
    sats.push({ name, line1, line2 });
  }
  return sats;
}

function findSatByNoradId(noradId) {
  for (const g of GROUPS) {
    const bucket = state.groups.get(g.id);
    const found = bucket.sats.find((s) => s.noradId === noradId);
    if (found) return found;
  }
  return null;
}

// ---------- Data loading ----------

async function loadGroup(id) {
  const bucket = state.groups.get(id);
  const res = await fetch(`/api/gp?group=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed to load group ${id}`);
  const payload = await res.json();
  if (payload.error) throw new Error(payload.error);

  const parsed = parseTLE(payload.tle).slice(0, bucket.config.cap);

  for (const s of bucket.sats) {
    if (s.marker) map.removeLayer(s.marker);
  }

  bucket.sats = parsed
    .map(({ name, line1, line2 }) => {
      let satrec = null;
      try {
        satrec = satellite.twoline2satrec(line1, line2);
      } catch (e) {
        satrec = null;
      }
      const noradId = line1.slice(2, 7).trim();
      return { name, noradId, satrec, marker: null, lastAlt: null, groupId: id, line1 };
    })
    .filter((s) => s.satrec);

  bucket.loaded = true;
  bucket.updated = payload.updated;

  // Compute a real position (and heading) for every satellite BEFORE any
  // marker exists. Without this, markers are created at 0,0 and visibly
  // scatter across the map on the first propagation tick.
  primePositions(bucket);
  buildMarkers(id);
}

// Seeds lastLat/lastLon/lastAlt/heading so markers can be born in the right
// place. Heading comes from a position 30s ahead, which is a stable way to
// get direction of travel without needing a previous frame.
function primePositions(bucket) {
  const now = new Date();
  const ahead = new Date(now.getTime() + 30000);
  const gmst = satellite.gstime(now);
  const gmstAhead = satellite.gstime(ahead);

  for (const s of bucket.sats) {
    const pv = safePropagate(s.satrec, now);
    if (!pv) continue;
    const gd = satellite.eciToGeodetic(pv.position, gmst);
    s.lastLat = satellite.degreesLat(gd.latitude);
    s.lastLon = satellite.degreesLong(gd.longitude);
    s.lastAlt = gd.height;

    const pv2 = safePropagate(s.satrec, ahead);
    if (pv2) {
      const gd2 = satellite.eciToGeodetic(pv2.position, gmstAhead);
      s.heading = bearingBetween(
        s.lastLat, s.lastLon,
        satellite.degreesLat(gd2.latitude), satellite.degreesLong(gd2.longitude)
      );
    } else {
      s.heading = 0;
    }
  }
}

// Initial compass bearing from point 1 to point 2, in degrees clockwise from
// north — used to rotate each satellite icon so it faces where it's going.
function bearingBetween(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

// Relative on-screen size by object class. Not to scale (a real satellite
// would be sub-pixel at world zoom) — it's a legible size *ranking* so a
// space station reads as bigger than a smallsat at a glance.
const SIZE_CLASSES = {
  xl: 30, // crewed stations
  lg: 24, // great observatories, big GEO comsats
  md: 19, // weather / science / navigation
  sm: 14, // smallsats, Starlink
};

function sizeClassFor(sat, groupId) {
  const n = sat.name || '';
  if (/\bISS\b|ZARYA|TIANGONG|\bCSS\b/i.test(n)) return 'xl';
  if (/HUBBLE|\bHST\b|\bJWST\b|WEBB|DRAGON|SOYUZ|PROGRESS|CYGNUS/i.test(n)) return 'lg';
  if (groupId === 'geo') return 'lg';
  if (groupId === 'starlink') return 'sm';
  if (groupId === 'weather' || groupId === 'science' || groupId === 'gps-ops') return 'md';
  if (groupId === 'stations') return 'xl';
  return 'md';
}

// Simple satellite silhouette: bus + two solar wings + dish, drawn nose-up so
// a CSS rotation of `heading` degrees points it along its track. Fill/stroke
// use currentColor so CSS alone can swap a marker between its resting tint
// and its bold selected color (see .sat-wrap / .sat-wrap.sat-selected).
function satelliteGlyphSVG() {
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <g stroke="#251f14" stroke-width="1" fill="currentColor" stroke-linejoin="round">
      <rect x="9.5" y="8" width="5" height="8" rx="1"/>
      <rect x="1.5" y="9.5" width="7" height="5" rx="0.6"/>
      <rect x="15.5" y="9.5" width="7" height="5" rx="0.6"/>
      <path d="M12 8 L12 3.5"/>
      <circle cx="12" cy="2.6" r="2"/>
    </g>
    <path d="M12 16 L12 21" stroke="currentColor" stroke-width="1.6" opacity="0.85"/>
  </svg>`;
}

function buildMarkers(id) {
  const bucket = state.groups.get(id);
  const visible = isVisible(id);
  const color = bucket.config.color;
  const light = bucket.config.light || color;

  for (const s of bucket.sats) {
    if (s.marker) continue;

    const known = knownObjectFor(s.name);
    s.known = known;
    s.sizeClass = sizeClassFor(s, id);
    const px = SIZE_CLASSES[s.sizeClass];

    // Markers are born at their primed position, so nothing starts at 0,0.
    const startLatLng = (s.lastLat != null && s.lastLon != null) ? [s.lastLat, s.lastLon] : [0, 0];

    const label = known ? `<span class="sat-name-tag">${known.short}</span>` : '';
    s.baseZIndex = known ? 1000 : 0; // keep famous objects above the swarm; restored after deselecting
    const marker = L.marker(startLatLng, {
      icon: L.divIcon({
        className: 'sat-marker',
        html: `<span class="sat-wrap" style="--sz:${px}px;--scolor:${color};--scolor-fill:${light}">
                 <span class="sat-rot" style="transform:rotate(${(s.heading || 0).toFixed(0)}deg)">${satelliteGlyphSVG()}</span>
                 ${label}
               </span>`,
        iconSize: [px, px],
        iconAnchor: [px / 2, px / 2],
      }),
      zIndexOffset: s.baseZIndex,
      keyboard: false,
    });

    marker.on('click', () => selectSatellite(s));
    marker.bindTooltip(known ? `${known.name} (${s.name})` : s.name, {
      direction: 'top', offset: [0, -px / 2 - 2], className: 'sat-tooltip',
    });
    if (visible) marker.addTo(map);
    s.marker = marker;
  }
}

// ---------- Tabs ----------

// Tabs are a multi-select filter now, not a radio group: any combination of
// groups can be shown together. "All" is a shortcut that selects every group
// rather than a mode of its own, and lights up whenever the full set happens
// to be selected.
function renderTabs() {
  const bar = document.getElementById('tab-bar');
  bar.innerHTML = '';
  const allActive = GROUPS.every((g) => state.activeGroups.has(g.id));
  const tabs = [ALL_TAB, ...GROUPS];
  for (const t of tabs) {
    const isAll = t.id === 'all';
    const active = isAll ? allActive : state.activeGroups.has(t.id);
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (active ? ' active' : '');
    btn.title = isAll ? 'Show every group' : 'Click to toggle this group on/off — you can show several at once';
    btn.style.setProperty('--tab-color', t.color);
    const count = isAll ? totalLoadedCount() : (state.groups.get(t.id).loaded ? state.groups.get(t.id).sats.length : '…');
    btn.innerHTML = `<span class="tab-dot"></span>${t.label}<span class="tab-count">${count}</span>`;
    btn.addEventListener('click', () => toggleTab(t.id));
    bar.appendChild(btn);
  }
}

function totalLoadedCount() {
  let n = 0;
  for (const g of GROUPS) {
    const b = state.groups.get(g.id);
    if (b.loaded) n += b.sats.length;
  }
  return n;
}

async function toggleTab(tabId) {
  const allActive = GROUPS.every((g) => state.activeGroups.has(g.id));

  if (tabId === 'all') {
    state.activeGroups = new Set(GROUPS.map((g) => g.id));
  } else if (allActive) {
    // Starting from "everything shown": picking a specific group means
    // "show me just this one", not "hide this one out of everything".
    state.activeGroups = new Set([tabId]);
  } else if (state.activeGroups.has(tabId)) {
    // Already narrowed down — toggle this group out of the working set.
    // Don't allow toggling off the last remaining group — an empty map
    // reads as broken, not "filtered to nothing".
    if (state.activeGroups.size > 1) state.activeGroups.delete(tabId);
  } else {
    // Already narrowed down — add this group alongside whatever's active.
    state.activeGroups.add(tabId);
  }

  renderTabs();
  updateOverview();

  const toShow = GROUPS.filter((g) => isVisible(g.id));
  const needLoad = toShow.filter((g) => !state.groups.get(g.id).loaded);

  if (needLoad.length) {
    setOverlay(true);
    try {
      await Promise.all(needLoad.map((g) => loadGroup(g.id)));
    } catch (err) {
      console.error(err);
    }
    setOverlay(false);
  }

  // Sync markers on/off the map for every group based on visibility
  for (const g of GROUPS) {
    const bucket = state.groups.get(g.id);
    const visible = isVisible(g.id);
    for (const s of bucket.sats) {
      if (!s.marker) continue;
      if (visible && !map.hasLayer(s.marker)) s.marker.addTo(map);
      if (!visible && map.hasLayer(s.marker)) map.removeLayer(s.marker);
    }
  }

  renderTabs();
  updateOverview();
  updateMeta();
  updateCharts();
}

function updateOverview() {
  const allActive = GROUPS.every((g) => state.activeGroups.has(g.id));
  let label;
  let count;
  if (allActive) {
    label = 'All';
    count = totalLoadedCount();
  } else if (state.activeGroups.size === 1) {
    const only = [...state.activeGroups][0];
    const g = GROUPS.find((x) => x.id === only);
    label = g ? g.label : only;
    count = state.groups.get(only).loaded ? state.groups.get(only).sats.length : '…';
  } else {
    label = `${state.activeGroups.size} groups`;
    const buckets = [...state.activeGroups].map((id) => state.groups.get(id));
    count = buckets.every((b) => b.loaded) ? buckets.reduce((n, b) => n + b.sats.length, 0) : '…';
  }
  document.getElementById('ov-label').textContent = label;
  document.getElementById('ov-count').textContent = count;
}

function updateMeta() {
  const meta = document.getElementById('data-meta');
  const loadedBuckets = [...state.groups.values()].filter((b) => b.loaded && b.updated && isVisible(b.config.id));
  if (loadedBuckets.length === 0) {
    meta.textContent = '—';
    return;
  }
  const oldest = Math.min(...loadedBuckets.map((b) => b.updated));
  const mins = Math.max(0, Math.round((Date.now() - oldest) / 60000));
  meta.textContent = `TLE data cached ${mins}m ago · source: CelesTrak`;
}

// ---------- Selection / detail panel ----------

let selectedMarkerPath = null;
let selectedTagEl = null;

function selectSatellite(sat) {
  const previous = state.selected;
  state.selected = sat;
  pulseStart = Date.now();

  // Undo the previous marker's selected treatment: drop its z-boost, and
  // either remove the ad-hoc tag we injected or restore a known object's
  // permanent tag back to its plain (non-"selected") text.
  if (selectedMarkerPath) selectedMarkerPath.classList.remove('sat-selected');
  if (previous && previous.marker) previous.marker.setZIndexOffset(previous.baseZIndex || 0);
  if (selectedTagEl) {
    if (previous && previous.known) {
      selectedTagEl.classList.remove('sat-tag-selected');
      selectedTagEl.textContent = previous.known.short;
    } else {
      selectedTagEl.remove();
    }
  }
  selectedTagEl = null;

  const el = sat.marker && sat.marker.getElement();
  const wrap = el && el.querySelector('.sat-wrap');
  if (wrap) {
    wrap.classList.add('sat-selected');
    selectedMarkerPath = wrap;

    // Every selected satellite gets a callout, not just the "known" ones —
    // a small nudge pointing at the sidebar rather than a loud banner.
    let tag = wrap.querySelector('.sat-name-tag');
    if (!tag) {
      tag = document.createElement('span');
      tag.className = 'sat-name-tag';
      wrap.appendChild(tag);
    }
    tag.classList.add('sat-tag-selected');
    tag.textContent = `${sat.known ? sat.known.short : sat.name} · details →`;
    selectedTagEl = tag;
  }
  if (sat.marker) sat.marker.setZIndexOffset(3000);

  // Ring color follows the satellite's group identity color instead of a
  // flat neutral, so the pulse reads as "this one" rather than generic UI chrome.
  const bucket = state.groups.get(sat.groupId);
  const groupColor = (bucket && bucket.config && bucket.config.color) || '#251f14';
  selectedRing.setStyle({ color: groupColor, weight: 2.5 });
  if (!map.hasLayer(selectedRing)) selectedRing.addTo(map);

  // Zoom in slightly and center on the satellite so the selection is
  // unmistakable, without yanking the view around if already in close.
  if (sat.lastLat != null && sat.lastLon != null) {
    const targetZoom = Math.min(Math.max(map.getZoom() + 1, 4), 6);
    map.flyTo([sat.lastLat, sat.lastLon], targetZoom, { animate: true, duration: 0.7 });
  }

  // A fresh selection starts with the ground track hidden
  state.showTrack = false;
  clearGroundTrack();
  const trackBtn = document.getElementById('track-toggle-btn');
  if (trackBtn) trackBtn.textContent = 'Show ground track';

  document.getElementById('detail-empty').hidden = true;
  document.getElementById('detail-body').hidden = false;
  document.getElementById('d-name').textContent = sat.name;
  document.getElementById('d-norad').textContent = sat.noradId;

  // Quiet flash on the sidebar panel so a new pick visibly "arrives" there.
  const detailPanel = document.getElementById('detail-panel');
  if (detailPanel) {
    detailPanel.classList.remove('panel-flash');
    // Force reflow so the animation restarts on repeated selections.
    void detailPanel.offsetWidth;
    detailPanel.classList.add('panel-flash');
  }

  renderSatelliteSchematic(sat);

  // Refresh immediately rather than waiting for the next periodic tick, so
  // the selected-object highlight in the dome (and its quick-select list)
  // shows up right away.
  if (state.domeActive && typeof renderDomeView === 'function') renderDomeView();
}

const EARTH_RADIUS_KM = 6378.137;
const MU_EARTH = 398600.4418; // km^3/s^2

function parseDesignator(line1) {
  if (!line1) return null;
  const raw = line1.slice(9, 17).trim();
  const m = raw.match(/^(\d{2})(\d{3})([A-Z]*)$/);
  if (!m) return { raw, yearFull: null, launchNum: null, piece: null };
  const yy = parseInt(m[1], 10);
  const yearFull = yy < 57 ? 2000 + yy : 1900 + yy; // Sputnik-era convention
  return { raw, yearFull, launchNum: m[2], piece: m[3] || '' };
}

function updateDetailPanel(now) {
  if (!state.selected) return;
  const sat = state.selected;
  const satrec = sat.satrec;
  const pv = safePropagate(satrec, now);
  if (!pv) return;
  const gmst = satellite.gstime(now);
  const gd = satellite.eciToGeodetic(pv.position, gmst);
  const lat = satellite.degreesLat(gd.latitude);
  const lon = satellite.degreesLong(gd.longitude);
  const alt = gd.height;
  const vel = Math.sqrt(pv.velocity.x ** 2 + pv.velocity.y ** 2 + pv.velocity.z ** 2);
  const periodMin = (2 * Math.PI) / satrec.no;

  document.getElementById('d-lat').textContent = `${lat.toFixed(2)}°`;
  document.getElementById('d-lon').textContent = `${lon.toFixed(2)}°`;
  document.getElementById('d-alt').textContent = `${alt.toFixed(0)} km`;
  document.getElementById('d-vel').textContent = `${vel.toFixed(2)} km/s`;
  document.getElementById('d-period').textContent = `${periodMin.toFixed(1)} min`;

  selectedRing.setLatLng([lat, lon]);

  // ---- Telemetry sub-tab: extended mean orbital elements from the TLE ----
  const inclDeg = (satrec.inclo * 180) / Math.PI;
  const ecc = satrec.ecco;
  const periodSec = periodMin * 60;
  const semiMajorAxis = Math.cbrt(MU_EARTH * (periodSec / (2 * Math.PI)) ** 2);
  const apogeeAlt = semiMajorAxis * (1 + ecc) - EARTH_RADIUS_KM;
  const perigeeAlt = semiMajorAxis * (1 - ecc) - EARTH_RADIUS_KM;
  const revPerDay = 1440 / periodMin;

  document.getElementById('t-incl').textContent = `${inclDeg.toFixed(2)}°`;
  document.getElementById('t-ecc').textContent = ecc.toFixed(4);
  document.getElementById('t-apogee').textContent = `${apogeeAlt.toFixed(0)} km`;
  document.getElementById('t-perigee').textContent = `${perigeeAlt.toFixed(0)} km`;
  document.getElementById('t-meanmotion').textContent = `${revPerDay.toFixed(2)} rev/day`;

  const jd = satrec.jdsatepoch + (satrec.jdsatepochF || 0);
  if (jd) {
    const epochDate = new Date((jd - 2440587.5) * 86400000);
    document.getElementById('t-epoch').textContent = epochDate.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }

  const designator = parseDesignator(sat.line1);
  if (designator && designator.yearFull) {
    document.getElementById('t-designator').textContent = `${designator.yearFull}-${designator.launchNum}${designator.piece}`;
    document.getElementById('t-launchyear').textContent = designator.yearFull;
    document.getElementById('d-launched').textContent = designator.yearFull;
  } else {
    document.getElementById('t-designator').textContent = '—';
    document.getElementById('t-launchyear').textContent = '—';
    document.getElementById('d-launched').textContent = '—';
  }

  // ---- Trajectory sub-tab ----
  const heading = pv.velocity.z >= 0 ? 'Ascending (N-bound)' : 'Descending (S-bound)';
  document.getElementById('tr-heading').textContent = heading;
  document.getElementById('tr-revday').textContent = `${revPerDay.toFixed(2)}`;

  if (sat.heading != null) {
    const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((sat.heading % 360) + 360) % 360 / 45) % 8];
    document.getElementById('d-heading').textContent = `${compass} ${(((sat.heading % 360) + 360) % 360).toFixed(0)}°`;
  }

  if (state.showTrack) updateGroundTrack(sat, now, periodMin);
}

// ---------- Propagation loop ----------

function safePropagate(satrec, date) {
  try {
    const pv = satellite.propagate(satrec, date);
    if (!pv || !pv.position || !pv.velocity) return null;
    return pv;
  } catch (e) {
    return null;
  }
}

function tick() {
  const now = new Date();
  const gmst = satellite.gstime(now);

  for (const g of GROUPS) {
    if (!isVisible(g.id)) continue;
    const bucket = state.groups.get(g.id);
    for (const s of bucket.sats) {
      const pv = safePropagate(s.satrec, now);
      if (!pv) continue;
      const gd = satellite.eciToGeodetic(pv.position, gmst);
      const lat = satellite.degreesLat(gd.latitude);
      const lon = satellite.degreesLong(gd.longitude);

      // Heading from the previous frame to this one, ignoring the jump when
      // the ground track wraps across the antimeridian.
      if (s.lastLat != null && Math.abs(lon - s.lastLon) < 180) {
        const moved = Math.abs(lat - s.lastLat) + Math.abs(lon - s.lastLon);
        if (moved > 0.0005) s.heading = bearingBetween(s.lastLat, s.lastLon, lat, lon);
      }

      s.lastAlt = gd.height;
      s.lastLat = lat;
      s.lastLon = lon;

      if (s.marker) {
        s.marker.setLatLng([lat, lon]);
        // Cache the rotating element once; re-querying every tick is costly
        // with several hundred markers on screen.
        if (!s.rotEl) {
          const el = s.marker.getElement();
          if (el) s.rotEl = el.querySelector('.sat-rot');
        }
        if (s.rotEl && s.heading != null) {
          s.rotEl.style.transform = `rotate(${s.heading.toFixed(0)}deg)`;
        }
      }
    }
  }

  updateDetailPanel(now);
  updateClock(now);
}

function updateClock(now) {
  document.getElementById('clock').textContent = now.toISOString().slice(11, 19);
  const hud = document.getElementById('hud-tracked');
  if (hud) hud.textContent = totalLoadedCount();
}

// ---------- Map tools (labels / clouds / legend) ----------

function initMapTools() {
  const labelsBtn = document.getElementById('labels-toggle');
  const cloudsBtn = document.getElementById('clouds-toggle');
  const legendBtn = document.getElementById('legend-toggle');
  const legend = document.getElementById('map-legend');

  labelsBtn.addEventListener('click', () => {
    state.labelsEnglish = !state.labelsEnglish;
    applyBasemap();
    labelsBtn.classList.toggle('active', state.labelsEnglish);
    labelsBtn.textContent = state.labelsEnglish ? '🌐 EN' : '🌐 LOCAL';
    labelsBtn.title = state.labelsEnglish
      ? 'Showing English place names — click for local languages'
      : 'Showing local-language place names — click for English';
  });

  cloudsBtn.addEventListener('click', () => {
    const on = map.hasLayer(cloudLayer);
    if (on) map.removeLayer(cloudLayer); else cloudLayer.addTo(map);
    cloudsBtn.classList.toggle('active', !on);
  });

  legendBtn.addEventListener('click', () => {
    const hidden = legend.classList.toggle('collapsed');
    legendBtn.classList.toggle('active', !hidden);
  });

  legendBtn.classList.add('active');
}

// ---------- Charts refresh ----------

function updateCharts() {
  const visibleGroups = GROUPS.filter((g) => isVisible(g.id));

  // A donut with one slice is just a circle — nothing to compare it against.
  // Swap it for a short note and push the panel below the more useful ones
  // instead of burning a huge chunk of the sidebar on a single color.
  const singleGroup = visibleGroups.length <= 1;
  const compositionPanel = document.getElementById('composition-panel');
  const compositionNote = document.getElementById('composition-single-note');
  const pieCanvas = document.getElementById('pie-chart');
  if (compositionPanel) compositionPanel.classList.toggle('panel-deprioritized', singleGroup);
  if (compositionNote) compositionNote.hidden = !singleGroup;
  if (pieCanvas) pieCanvas.hidden = singleGroup;

  pieChart.data.labels = visibleGroups.map((g) => g.label);
  pieChart.data.datasets[0].data = visibleGroups.map((g) => state.groups.get(g.id).sats.length);
  pieChart.data.datasets[0].backgroundColor = visibleGroups.map((g) => g.color);
  pieChart.update();

  const buckets = [0, 0, 0, 0];
  for (const g of visibleGroups) {
    const bucket = state.groups.get(g.id);
    for (const s of bucket.sats) {
      const alt = s.lastAlt;
      if (alt == null) continue;
      if (alt < 2000) buckets[0]++;
      else if (alt < 35000) buckets[1]++;
      else if (alt <= 36500) buckets[2]++;
      else buckets[3]++;
    }
  }
  barChart.data.datasets[0].data = buckets;
  barChart.update();

  renderCrossSection();
  if (state.domeActive) renderDomeView();
  if (state.horizonActive) renderSatHorizon();
}

// ---------- Overlay ----------

function setOverlay(show) {
  const el = document.getElementById('loading-overlay');
  el.classList.toggle('hidden', !show);
}

// ---------- Ticker: fun facts + live stats ----------

const FACTS = [
  'Fun fact: the ISS completes a full orbit roughly every 93 minutes — about 16 sunrises a day for the crew.',
  'Starlink satellites are designed to fully burn up on reentry — no orbital litter allowed by design.',
  'GPS satellites carry atomic clocks accurate to nanoseconds; without relativistic correction, GPS would drift ~10km/day.',
  'Geostationary satellites orbit at about 35,786km, matching Earth\'s rotation so they hover over one spot.',
  'The Kármán line, the informal edge of space, sits about 100km up — most satellites here orbit far above it.',
  'There are tens of thousands of tracked objects larger than 10cm currently in orbit around Earth.',
  'Low Earth Orbit satellites move at roughly 7.8 km/s — fast enough to cross the continental US in under 10 minutes.',
  'CelesTrak has published orbital data for the space community since the 1980s, well before the modern internet.',
  'Orbital traffic control is a real and growing job — operators actively dodge debris and other satellites.',
  'The data on this screen updates every couple seconds using real orbital mechanics (SGP4), not a fake animation.',
];

let factIndex = 0;

function nextTickerMessage() {
  // Alternate between a static fact and a live stat when possible
  const useStat = factIndex % 2 === 1;
  factIndex++;

  if (useStat) {
    const stat = computeLiveStat();
    if (stat) return stat;
  }

  const fact = FACTS[factIndex % FACTS.length];
  return fact;
}

function computeLiveStat() {
  const options = [];
  const total = totalLoadedCount();
  if (total > 0) {
    options.push(`Currently tracking ${total} satellite${total === 1 ? '' : 's'} in the "${document.getElementById('ov-label').textContent}" section.`);
  }
  if (state.selected && state.selected.lastAlt != null) {
    options.push(`${state.selected.name} is ${Math.round(state.selected.lastAlt)}km up right now.`);
  }
  // Highest / fastest in current view
  let highest = null;
  for (const g of GROUPS) {
    if (!isVisible(g.id)) continue;
    for (const s of state.groups.get(g.id).sats) {
      if (s.lastAlt != null && (!highest || s.lastAlt > highest.lastAlt)) highest = s;
    }
  }
  if (highest) {
    options.push(`Highest object in view: ${highest.name} at ${Math.round(highest.lastAlt)}km.`);
  }
  if (options.length === 0) return null;
  return options[Math.floor(Math.random() * options.length)];
}

function updateTicker() {
  const el = document.getElementById('ticker-text');
  el.textContent = nextTickerMessage();
  el.style.animation = 'none';
  // Force reflow so restarting the animation actually takes effect
  void el.offsetWidth;
  // Slower, steadier crawl than the previous version
  const duration = Math.max(20, el.textContent.length * 0.22);
  el.style.animation = `ticker-scroll ${duration}s linear`;
}

document.getElementById('ticker-text').addEventListener('animationend', updateTicker);

// ---------- Init ----------

async function init() {
  renderTabs();
  updateOverview();
  await toggleTab('all');

  tick();
  updateTicker();

  setInterval(() => {
    tick();
    updateCharts();
    updateOverview();
  }, 2000);

  setInterval(updateMeta, 30000);
}

document.getElementById('refresh-btn').addEventListener('click', async () => {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  btn.textContent = 'Refreshing…';
  setOverlay(true);
  try {
    const visibleGroups = GROUPS.filter((g) => isVisible(g.id));
    await Promise.all(visibleGroups.map((g) => loadGroup(g.id)));
    updateCharts();
    updateOverview();
    updateMeta();
    renderTabs();
  } catch (err) {
    console.error(err);
  }
  setOverlay(false);
  btn.disabled = false;
  btn.textContent = '↻ Refresh TLE data';
});

// ---------- Selected-satellite sub-tabs ----------

document.querySelectorAll('.subtab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.subtab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.subtab-content').forEach((c) => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`subtab-${btn.dataset.subtab}`).classList.add('active');
  });
});

document.getElementById('track-toggle-btn').addEventListener('click', () => {
  if (!state.selected) return;
  state.showTrack = !state.showTrack;
  const btn = document.getElementById('track-toggle-btn');
  if (state.showTrack) {
    btn.textContent = 'Hide ground track';
    updateGroundTrack(state.selected, new Date(), (2 * Math.PI) / state.selected.satrec.no);
  } else {
    btn.textContent = 'Show ground track';
    clearGroundTrack();
  }
});

// ---------- Map / Dome view toggle ----------

function setTrackerView(which) {
  const ids = { map: 'view-map-btn', dome: 'view-dome-btn', horizon: 'view-horizon-btn' };
  for (const [k, id] of Object.entries(ids)) {
    document.getElementById(id).classList.toggle('active', k === which);
  }
  document.getElementById('map').hidden = which !== 'map';
  document.getElementById('dome-view').hidden = which !== 'dome';
  document.getElementById('horizon-view').hidden = which !== 'horizon';
  document.getElementById('dome-controls').hidden = which !== 'dome';
  if (which !== 'dome') document.getElementById('dome-object-list').hidden = true;
  document.getElementById('map-tools').style.display = which === 'map' ? '' : 'none';
  document.getElementById('map-legend').style.display = which === 'map' ? '' : 'none';

  state.domeActive = which === 'dome';
  state.horizonActive = which === 'horizon';

  if (which === 'map') setTimeout(() => map.invalidateSize(), 50);
  if (which === 'dome') renderDomeView();
  if (which === 'horizon') {
    // Coastlines load once, then every later render is instant
    loadLandOutlines().then(renderSatHorizon);
    renderSatHorizon();
  }
}

document.getElementById('view-map-btn').addEventListener('click', () => setTrackerView('map'));
document.getElementById('view-dome-btn').addEventListener('click', () => setTrackerView('dome'));
document.getElementById('view-horizon-btn').addEventListener('click', () => setTrackerView('horizon'));
document.getElementById('hemi-west').addEventListener('click', () => setHemisphere('west'));
document.getElementById('hemi-east').addEventListener('click', () => setHemisphere('east'));

document.getElementById('dome-zoom-in').addEventListener('click', () => setDomeZoom(0.25));
document.getElementById('dome-zoom-out').addEventListener('click', () => setDomeZoom(-0.25));
document.getElementById('dome-tilt-up').addEventListener('click', () => setDomeTilt(-8));
document.getElementById('dome-tilt-down').addEventListener('click', () => setDomeTilt(8));
// Wrapped in a closure (rather than passed directly) because resetDomeView is
// defined in blueprint.js, which loads after this file — a direct reference
// here would throw at registration time and silently abort the rest of this
// script's setup code below it.
document.getElementById('dome-reset').addEventListener('click', () => resetDomeView());

// Scroll wheel over the dome zooms it, matching the map's behaviour
document.getElementById('dome-view').addEventListener('wheel', (e) => {
  if (!state.domeActive) return;
  e.preventDefault();
  setDomeZoom(e.deltaY < 0 ? 0.15 : -0.15);
}, { passive: false });

// Note: init() and initModeToggle() are called from a bootstrap <script> at the
// bottom of index.html, after this file, blueprint.js, and launches.js have
// all finished loading — so functions defined in those files are guaranteed
// to exist by the time init() actually runs.
