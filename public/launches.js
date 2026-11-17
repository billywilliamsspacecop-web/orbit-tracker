// launches.js — Tracker/Launches mode toggle, the launches list, and the 2.5D
// line-art launch dome with an animated rocket.
//
// On flight paths: real rocket ascent telemetry isn't published anywhere
// public, for past OR future launches. So rather than fabricating a precise
// path, the dome shows two things that ARE real public data — the launch
// pad (from Launch Library 2) and the mission's actual stated target orbit
// class — connected by an obviously-stylised ascent arc. Labeled as
// illustrative everywhere it appears.

const ROCKET_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">
  <path d="M12 2c2.5 2 4 5.5 4 9.5 0 2-.5 4-1 5.5h-6c-.5-1.5-1-3.5-1-5.5C8 7.5 9.5 4 12 2z"/>
  <path d="M8 15l-3 4h3z"/><path d="M16 15l3 4h-3z"/>
  <circle cx="12" cy="9" r="1.4"/>
  <path d="M10.3 17h3.4l-.6 3.5a1 1 0 01-1.9 0z"/>
</svg>`;

let launchesCache = null; // { upcoming, previous, fetchedAt }
const LAUNCHES_CLIENT_TTL_MS = 10 * 60 * 1000;
const launchesById = new Map();

function statusClass(abbrev) {
  const a = (abbrev || '').toLowerCase();
  if (a.includes('success')) return 'status-success';
  if (a.includes('fail')) return 'status-failure';
  if (a === 'go' || a.includes('flight')) return 'status-go';
  return 'status-tbd';
}

function formatCountdown(netIso) {
  const diffMs = new Date(netIso) - new Date();
  const abs = Math.abs(diffMs);
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  const mins = Math.floor((abs % 3600000) / 60000);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (!days && mins) parts.push(`${mins}m`);
  const label = parts.length ? parts.join(' ') : '<1m';
  return diffMs >= 0 ? `T-minus ${label}` : `T-plus ${label}`;
}

// Explains exactly which piece of public data is missing, rather than
// silently dropping the button (which is what the old version did).
function trajectoryAvailability(l) {
  const missing = [];
  if (l.padLat == null || l.padLon == null) missing.push('launch pad coordinates');
  if (!classifyOrbit(l.orbit)) missing.push('target orbit');
  if (!missing.length) return { ok: true };
  return { ok: false, reason: `No ${missing.join(' or ')} published for this launch yet` };
}

function renderLaunchCard(l, upcoming) {
  launchesById.set(l.id, { ...l, upcoming });
  const cls = statusClass(l.statusAbbrev);
  const when = l.net ? new Date(l.net).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'Date TBD';
  const countdown = l.net ? formatCountdown(l.net) : '';
  const avail = trajectoryAvailability(l);

  const btn = avail.ok
    ? `<button class="flightpath-btn" data-id="${escapeXml(l.id)}">Show flight path</button>`
    : `<button class="flightpath-btn" disabled title="${escapeXml(avail.reason)}">Flight path unavailable</button>
       <div class="flightpath-missing">${escapeXml(avail.reason)}</div>`;

  return `
    <div class="launch-card ${cls}">
      <span class="launch-rocket-icon ${cls}">${ROCKET_ICON}</span>
      <div class="launch-body">
        <div class="launch-name">${escapeXml(l.name || 'Unknown mission')}</div>
        <div class="launch-meta">
          ${escapeXml(l.rocket || '—')} · ${escapeXml(l.provider || '—')}<br>
          ${escapeXml(l.location || l.pad || '—')}<br>
          ${when}${countdown ? ' · ' + countdown : ''}
          ${l.orbit ? '<br>Target: ' + escapeXml(l.orbit) : ''}
        </div>
        <div class="launch-actions">
          ${btn}
          <button class="flightpath-btn details-btn" data-details="${escapeXml(l.id)}">Details ▸</button>
        </div>
      </div>
      <span class="launch-status ${cls}">${escapeXml(l.statusAbbrev || l.statusName || '—')}</span>
    </div>
  `;
}

// ---------- Launch detail drawer ----------

function launchDrawerHTML(l) {
  const cls = statusClass(l.statusAbbrev);
  const when = l.net ? new Date(l.net).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'Date TBD';
  const countdown = l.net ? formatCountdown(l.net) : '';
  const target = classifyOrbit(l.orbit);

  return `
    <div class="ld-head">
      ${l.image ? `<img class="ld-image" src="${escapeXml(l.image)}" alt="${escapeXml(l.name || '')}" />` : ''}
      <div class="ld-headtext">
        <div class="ld-kicker">${escapeXml(l.provider || 'Unknown provider')}</div>
        <h2 class="ld-name" id="ld-name">${escapeXml(l.name || 'Unknown mission')}</h2>
        <div class="ld-badges">
          <span class="launch-status ${cls}">${escapeXml(l.statusName || l.statusAbbrev || '—')}</span>
          <span class="ld-chip">${escapeXml(when)}</span>
          ${countdown ? `<span class="ld-chip ld-chip-hot">${escapeXml(countdown)}</span>` : ''}
        </div>
      </div>
    </div>

    <div class="ld-section">
      <h3>Vehicle &amp; mission</h3>
      <div class="detail-grid">
        <div><span>Rocket</span><strong>${escapeXml(l.rocket || '—')}</strong></div>
        <div><span>Provider</span><strong>${escapeXml(l.providerAbbrev || l.provider || '—')}</strong></div>
        <div><span>Mission</span><strong>${escapeXml(l.mission || '—')}</strong></div>
        <div><span>Type</span><strong>${escapeXml(l.missionType || '—')}</strong></div>
        <div><span>Target orbit</span><strong>${escapeXml(l.orbit || 'Not published')}</strong></div>
        <div><span>Altitude band</span><strong>${target ? escapeXml(target.label) : '—'}</strong></div>
      </div>
    </div>

    <div class="ld-section">
      <h3>Launch site</h3>
      <div class="detail-grid">
        <div><span>Pad</span><strong>${escapeXml(l.pad || '—')}</strong></div>
        <div><span>Location</span><strong>${escapeXml(l.location || '—')}</strong></div>
        <div><span>Latitude</span><strong>${l.padLat != null ? l.padLat.toFixed(4) + '°' : '—'}</strong></div>
        <div><span>Longitude</span><strong>${l.padLon != null ? l.padLon.toFixed(4) + '°' : '—'}</strong></div>
      </div>
    </div>

    <div class="ld-section">
      <h3>Pad weather</h3>
      <div id="ld-weather"><div class="detail-empty">—</div></div>
    </div>

    <div class="ld-section">
      <h3>Mission media</h3>
      <div class="media-tabs">
        <button class="media-tab active" data-ldmedia="image">🖼 Photos</button>
        <button class="media-tab" data-ldmedia="video">▶ Videos</button>
      </div>
      <div id="ld-media" class="schematic-wrap"></div>
    </div>
  `;
}

let drawerLaunch = null;

function openLaunchDrawer(l) {
  drawerLaunch = l;
  document.getElementById('launch-drawer-body').innerHTML = launchDrawerHTML(l);
  document.getElementById('launch-drawer').hidden = false;

  renderWeatherInto('ld-weather', l.padLat, l.padLon, l.location || l.pad);

  // Pull full detail so the webcast fallback and specs are available, then
  // re-run the media load now that we have somewhere to fall back to.
  fetchLaunchDetail(l.id).then(() => {
    if (drawerLaunch && drawerLaunch.id === l.id) {
      const active = document.querySelector('[data-ldmedia].active');
      loadDrawerMedia(active ? active.dataset.ldmedia : 'image');
    }
  });

  loadDrawerMedia('image');

  document.querySelectorAll('[data-ldmedia]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-ldmedia]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      loadDrawerMedia(btn.dataset.ldmedia);
    });
  });
}

// YouTube publishes predictable thumbnail URLs, so we can preview a webcast
// without an API key. Other hosts (X, etc.) supply their own feature image
// via the launch feed.
function youtubeId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}

function webcastCardsHTML(webcasts) {
  if (!webcasts || !webcasts.length) return '';
  return `
    <div class="wc-list">
      ${webcasts.slice(0, 4).map((w) => {
        const yt = youtubeId(w.url);
        const thumb = yt ? `https://img.youtube.com/vi/${yt}/hqdefault.jpg` : w.image;
        const host = w.source || (w.url ? (() => { try { return new URL(w.url).hostname.replace(/^www\./, ''); } catch (e) { return 'link'; } })() : 'link');
        return `
          <a class="wc-card" href="${escapeXml(w.url)}" target="_blank" rel="noopener">
            <span class="wc-thumb">
              ${thumb ? `<img src="${escapeXml(thumb)}" alt="" loading="lazy" onerror="this.style.display='none'"/>` : ''}
              <span class="wc-play">▶</span>
            </span>
            <span class="wc-body">
              <span class="wc-title">${escapeXml(w.title || 'Official webcast')}</span>
              <span class="wc-meta">${escapeXml(w.publisher || '')}${w.typeName ? ' · ' + escapeXml(w.typeName) : ''}</span>
              <span class="wc-host">Opens on ${escapeXml(host)} ↗</span>
            </span>
          </a>`;
      }).join('')}
    </div>
    <div class="meta">These are external webcast links published by the launch provider — hosted on their platforms, not by this app.</div>`;
}

function loadDrawerMedia(type) {
  if (!drawerLaunch) return;
  // Search on the rocket + mission name, which is what NASA's library indexes
  const q = [drawerLaunch.rocket, drawerLaunch.mission].filter(Boolean).join(' ') || drawerLaunch.name;

  renderMediaInto('ld-media', q, false, type, () => {
    // NASA has nothing public-domain for this mission — offer the official
    // webcast instead of a dead end.
    const detail = launchDetailCache.get(drawerLaunch.id);
    const cards = webcastCardsHTML(detail && detail.webcasts);
    const el = document.getElementById('ld-media');
    if (!el) return;
    el.innerHTML = cards
      ? `<div class="schematic-fallback-note">No public-domain ${type === 'video' ? 'footage' : 'imagery'} in NASA's library for this mission — here's the official webcast:</div>${cards}`
      : `<div class="schematic-fallback-note">No public-domain ${type === 'video' ? 'footage' : 'imagery'} found, and no official webcast link published for this mission.</div>`;
  });
}

function closeLaunchDrawer() {
  document.getElementById('launch-drawer').hidden = true;
  drawerLaunch = null;
}

function initLaunchDrawer() {
  document.getElementById('drawer-close').addEventListener('click', closeLaunchDrawer);
  document.getElementById('drawer-backdrop').addEventListener('click', closeLaunchDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('launch-drawer').hidden) closeLaunchDrawer();
  });
}

function renderLaunchList(containerId, launches, upcoming) {
  const el = document.getElementById(containerId);
  if (!launches || !launches.length) {
    el.innerHTML = '<div class="detail-empty">No data available right now.</div>';
    return;
  }
  el.innerHTML = launches.map((l) => renderLaunchCard(l, upcoming)).join('');
}

async function ensureLaunchesData() {
  if (launchesCache && Date.now() - launchesCache.fetchedAt < LAUNCHES_CLIENT_TTL_MS) {
    return launchesCache;
  }
  const [upRes, prevRes] = await Promise.all([
    fetch('/api/launches?type=upcoming').then((r) => r.json()),
    fetch('/api/launches?type=previous').then((r) => r.json()),
  ]);
  if (upRes.error || prevRes.error) throw new Error(upRes.error || prevRes.error);

  // Launch Library's "upcoming" feed can lag reality by an hour or more —
  // a launch that already lifted off sometimes sits at the top of it until
  // their editors update its status. We already compute a real T-minus/
  // T-plus countdown from `net`, so use that as the source of truth: drop
  // anything whose NET has already passed instead of showing a "next
  // launch" that's actually T-plus, and sort what's left soonest-first.
  const now = Date.now();
  const upcoming = (upRes.launches || [])
    .filter((l) => !l.net || new Date(l.net).getTime() > now)
    .sort((a, b) => {
      if (!a.net) return 1;
      if (!b.net) return -1;
      return new Date(a.net) - new Date(b.net);
    });

  launchesCache = { upcoming, previous: prevRes.launches, fetchedAt: Date.now() };
  return launchesCache;
}

// Compact cards for the right-hand rail, so the list isn't buried under
// the diagram.
function renderRail(containerId, launches, upcoming) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!launches || !launches.length) {
    el.innerHTML = '<div class="detail-empty">Nothing listed.</div>';
    return;
  }
  el.innerHTML = launches.slice(0, 5).map((l) => {
    launchesById.set(l.id, { ...l, upcoming });
    const when = l.net ? new Date(l.net) : null;
    return `
      <button class="rail-item" data-rail="${escapeXml(l.id)}">
        <span class="rail-dot ${statusClass(l.statusAbbrev)}"></span>
        <span class="rail-body">
          <span class="rail-name">${escapeXml(l.name || '')}</span>
          <span class="rail-meta">${escapeXml(l.provider || '')}</span>
          <span class="rail-when">${when ? escapeXml(when.toISOString().slice(5, 16).replace('T', ' ')) + ' UTC' : 'TBD'}
            ${l.net ? ' · ' + escapeXml(formatCountdown(l.net)) : ''}</span>
        </span>
      </button>`;
  }).join('');

  el.querySelectorAll('.rail-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const l = launchesById.get(btn.dataset.rail);
      if (!l) return;
      const listBtn = document.querySelector(`.flightpath-btn[data-id="${l.id}"]`);
      if (listBtn && !listBtn.disabled) toggleFlightPath(l, listBtn);
      else openLaunchDrawer(l);
    });
  });
}

async function refreshLaunchesView() {
  try {
    const data = await ensureLaunchesData();
    renderLaunchList('launches-upcoming', data.upcoming, true);
    renderLaunchList('launches-recent', data.previous, false);
    renderRail('rail-next', data.upcoming, true);
    renderRail('rail-recent', data.previous, false);
  } catch (err) {
    console.error(err);
    ['launches-upcoming', 'launches-recent', 'rail-next', 'rail-recent'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<div class="detail-empty">Could not load launch data.</div>';
    });
  }
}

// ---------- Orbit classification ----------

// Maps a mission's real publicly-stated orbit class to a representative
// altitude, used to decide how high up the dome the arc terminates.
function classifyOrbit(orbitName) {
  const name = (orbitName || '').toLowerCase();
  if (!name || name === 'unknown' || name === 'n/a') return null;
  if (name.includes('geostationary') || name.includes('geosynchronous')) {
    return { label: 'Geostationary', altKm: 35786, band: 'GEO' };
  }
  if (name.includes('molniya') || name.includes('highly elliptical')) {
    return { label: 'Highly Elliptical Orbit', altKm: 40000, band: 'HEO' };
  }
  if (name.includes('medium earth') || name.includes('gto') || name.includes('transfer')) {
    return { label: 'Transfer / Medium Earth Orbit', altKm: 20200, band: 'MEO' };
  }
  if (name.includes('sun-synchronous') || name.includes('polar')) {
    return { label: 'Sun-Synchronous / Polar Orbit', altKm: 700, band: 'LEO' };
  }
  if (name.includes('lunar') || name.includes('heliocentric') || name.includes('escape') ||
      name.includes('mars') || name.includes('interplanetary') || name.includes('trans-lunar')) {
    return { label: 'Beyond Earth orbit', altKm: 50000, band: 'ESCAPE' };
  }
  return { label: 'Low Earth Orbit', altKm: 500, band: 'LEO' };
}

// ---------- 2.5D launch dome ----------

// Taller than wide now (was 760x380, a 2:1 landscape letterbox that read as
// "sideways"). A launch is a climb first and a downrange drift second, so
// the canvas should read the same way.
const DOME_W = 620;
const DOME_H = 680;
// Circle centre sits far below the frame, so only the very top of the arc is
// visible => a gentle dome-shaped horizon. These values keep the whole curve
// (plus its pad labels) inside the canvas at every x.
const HORIZON_CY = 1683;
const HORIZON_R = 1221;

// Nominal altitudes used only to *space out* the band ladder (log scale) —
// not literal science. Real, wildly-varying LEO altitudes (300–2,000 km)
// would otherwise squash every LEO launch (the overwhelming majority) into
// the same sliver near the ground.
const BAND_INFO = {
  LEO: { abbrev: 'LEO', full: 'Low Earth Orbit', detail: '~500 km', altKm: 500 },
  MEO: { abbrev: 'MEO', full: 'Medium Earth Orbit', detail: '~20,200 km', altKm: 20200 },
  GEO: { abbrev: 'GEO', full: 'Geostationary Orbit', detail: '35,786 km', altKm: 35786 },
  HEO: { abbrev: 'HEO', full: 'Highly Elliptical Orbit', detail: '>36,500 km', altKm: 55000 },
  ESCAPE: { abbrev: 'ESC', full: 'Escape trajectory', detail: 'beyond Earth orbit', altKm: 120000 },
};
const BAND_ORDER = ['LEO', 'MEO', 'GEO', 'HEO', 'ESCAPE'];

// Where the ground and the top margin sit in the 0..DOME_H canvas.
const BAND_SURFACE_Y = 462; // matches the horizon peak (HORIZON_CY - HORIZON_R)
const BAND_TOP_Y = 55;

// Builds the band ladder for THIS launch only, log-spaced between the
// ground and whatever its actual target band is — so a LEO-only launch
// (most of them) gets that single band pinned near the top, using nearly
// the whole canvas for the climb, instead of a fixed ladder that reserves
// most of the height for MEO/GEO/HEO bands almost nothing ever reaches.
function bandLayoutFor(targetBand) {
  const idx = BAND_ORDER.indexOf(targetBand);
  const chain = idx === -1 ? ['LEO'] : BAND_ORDER.slice(0, idx + 1);
  const logs = chain.map((b) => Math.log10(BAND_INFO[b].altKm));
  const minLog = Math.log10(100); // just above "surface" on the log scale
  const maxLog = logs[logs.length - 1];
  return chain.map((b, i) => {
    const t = maxLog === minLog ? 1 : (logs[i] - minLog) / (maxLog - minLog);
    const y = BAND_SURFACE_Y - t * (BAND_SURFACE_Y - BAND_TOP_Y);
    return { band: b, y, ...BAND_INFO[b] };
  });
}

let rocketAnim = null;
let activeFlightPathId = null;

function horizonY(x) {
  // y on the dome-shaped horizon arc for a given x
  const dx = x - DOME_W / 2;
  const inner = HORIZON_R * HORIZON_R - dx * dx;
  return HORIZON_CY - Math.sqrt(Math.max(inner, 0));
}

// Coastlines drawn just under the horizon line. Longitude spans the visible
// arc, so a pad's real longitude lines up with the land beneath it.
function domeCoastPath(centerLon) {
  return coastlinePathData({
    centerLon,
    spanLon: 190,
    width: DOME_W,
    horizonYFn: horizonY,
    bandDepth: 74,
  });
}

function domeBandsSVG(layout, activeBand) {
  return layout.map((b) => `
    <line x1="0" y1="${b.y.toFixed(1)}" x2="${DOME_W}" y2="${b.y.toFixed(1)}" class="dome-band-line ${b.band === activeBand ? 'active' : ''}" />
    <text x="8" y="${(b.y - 5).toFixed(1)}" class="dome-band-label ${b.band === activeBand ? 'active' : ''}">${escapeXml(`${b.full} (${b.abbrev}) · ${b.detail}`)}</text>
  `).join('');
}

function horizonSVG(centerLon) {
  const pts = [];
  for (let x = 0; x <= DOME_W; x += 6) pts.push(`${x},${horizonY(x).toFixed(1)}`);
  const coast = domeCoastPath(centerLon);
  const groundTop = horizonY(DOME_W / 2);
  return `
    <path d="M0,${horizonY(0).toFixed(1)} ${pts.map((p) => 'L' + p).join(' ')} L${DOME_W},${DOME_H} L0,${DOME_H} Z" class="dome-ground" />
    ${coast ? `<path d="${coast}" class="dome-coast" />` : ''}
    <polyline points="${pts.join(' ')}" class="dome-horizon" />`;
}

function launchDomeEmptySVG(message) {
  return `
    <svg viewBox="0 0 ${DOME_W} ${DOME_H}" xmlns="http://www.w3.org/2000/svg">
      ${domeBandsSVG(bandLayoutFor('ESCAPE'), null)}
      ${horizonSVG(-60)}
      <text x="${DOME_W / 2}" y="${DOME_H - 24}" class="dome-hint-text" text-anchor="middle">${escapeXml(message)}</text>
    </svg>`;
}

function buildAscentPath(launch, target, layout) {
  const MARGIN = 55;
  const REACH = 150;

  // Pad sits on the horizon; horizontal position derived from real longitude
  // so different launch sites appear in different places along the arc.
  const rawPadX = DOME_W / 2 + (launch.padLon / 180) * (DOME_W * 0.32);
  const padX = Math.min(DOME_W - MARGIN, Math.max(MARGIN, rawPadX));
  const padY = horizonY(padX);

  const band = layout.find((b) => b.band === target.band) || layout[layout.length - 1];
  const endY = band.y;

  // Head downrange in the hemisphere's direction, but flip (and clamp) if
  // that would run the arc off the edge — pads near ±180° otherwise do.
  let dir = launch.padLon >= 0 ? 1 : -1;
  if (padX + dir * REACH > DOME_W - MARGIN || padX + dir * REACH < MARGIN) dir = -dir;
  const endX = Math.min(DOME_W - MARGIN, Math.max(MARGIN, padX + dir * REACH));

  const ctrlX = padX + (endX - padX) * 0.35;
  const ctrlY = padY - (padY - endY) * 0.92; // steep early climb, then downrange
  return { padX, padY, endX, endY, ctrlX, ctrlY, band };
}

function quadPoint(p, t) {
  const x = (1 - t) ** 2 * p.padX + 2 * (1 - t) * t * p.ctrlX + t ** 2 * p.endX;
  const y = (1 - t) ** 2 * p.padY + 2 * (1 - t) * t * p.ctrlY + t ** 2 * p.endY;
  return { x, y };
}

function renderLaunchDome(launch, detail) {
  const container = document.getElementById('launch-dome');
  if (!container) return;

  if (!launch) {
    container.innerHTML = launchDomeEmptySVG('Select a launch below to plot its ascent profile');
    return;
  }

  const target = classifyOrbit(launch.orbit);
  const layout = bandLayoutFor(target.band);
  const p = buildAscentPath(launch, target, layout);
  const color = launch.upcoming ? '#1f3550' : '#2c5a5c';
  const centerLon = launch.padLon != null ? launch.padLon : -60;

  // Where the booster comes down, if this mission actually attempts a
  // landing. Downrange distance is real data; we scale it onto the arc.
  let landX = null;
  if (detail && detail.landing && detail.landing.attempt) {
    const km = detail.landing.downrangeKm || 300;
    const dir = Math.sign(p.endX - p.padX) || 1;
    const pxPerKm = 0.16;
    landX = Math.min(DOME_W - 40, Math.max(40, p.padX + dir * km * pxPerKm));
  }

  container.innerHTML = `
    <svg viewBox="0 0 ${DOME_W} ${DOME_H}" xmlns="http://www.w3.org/2000/svg">
      ${domeBandsSVG(layout, target.band)}
      ${horizonSVG(centerLon)}

      <path d="M ${p.padX.toFixed(1)} ${p.padY.toFixed(1)} Q ${p.ctrlX.toFixed(1)} ${p.ctrlY.toFixed(1)} ${p.endX.toFixed(1)} ${p.endY.toFixed(1)}"
            fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="2 7" opacity="0.55" />

      <g class="dome-pad">
        <line x1="${p.padX.toFixed(1)}" y1="${p.padY.toFixed(1)}" x2="${p.padX.toFixed(1)}" y2="${(p.padY + 14).toFixed(1)}" />
        <circle cx="${p.padX.toFixed(1)}" cy="${p.padY.toFixed(1)}" r="4" fill="${color}" />
        <text x="${p.padX.toFixed(1)}" y="${(p.padY + 28).toFixed(1)}" class="dome-pad-label" text-anchor="middle">${escapeXml(launch.location || launch.pad || 'Launch pad')}</text>
      </g>

      <text x="${p.endX.toFixed(1)}" y="${(p.endY - 10).toFixed(1)}" class="dome-target-label" text-anchor="middle">${escapeXml(target.label)}</text>

      <g id="replay-layer"></g>

      <g id="dome-rocket" class="dome-rocket">
        <polygon points="0,-8 4,6 -4,6" fill="${color}" stroke="#251f14" stroke-width="0.8" />
        <polyline points="-3,6 0,14 3,6" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.9" />
      </g>
    </svg>
  `;

  // Note: the replay controls stay mounted at all times (they're only
  // enabled/disabled), so revealing a replay never reflows the page.
  const controls = document.getElementById('replay-controls');

  if (detail && detail.timeline && detail.timeline.length) {
    // Real timeline available — hand over to the replay engine
    document.getElementById('dome-rocket').style.display = 'none';
    controls.classList.remove('is-idle');
    beginReplay(detail, {
      padX: p.padX,
      padY: p.padY,
      orbitX: p.endX,
      orbitY: p.endY,
      // Same quadratic-curve control point as the dotted reference path
      // (drawn from this exact p below) — the rocket needs to fly the
      // curve itself, not just share its endpoints, or it visibly cuts
      // corners across the dotted line instead of riding it.
      ctrlX: p.ctrlX,
      ctrlY: p.ctrlY,
      // Where the stage drifts to while coasting in orbit after cutoff
      coastX: Math.min(DOME_W - 40, p.endX + 230),
      landX: landX != null ? landX : p.padX,
      padYAt: (x) => horizonY(x),
    });
  } else {
    controls.classList.add('is-idle');
    document.getElementById('replay-timeline').innerHTML =
      '<div class="detail-empty">No published mission timeline for this launch.</div>';
    startRocketAnimation(p);
  }
}

function startRocketAnimation(p) {
  if (rocketAnim) cancelAnimationFrame(rocketAnim);
  const rocket = document.getElementById('dome-rocket');
  if (!rocket) return;

  const DURATION_MS = 5200;
  const start = performance.now();

  function frame(now) {
    const t = ((now - start) % DURATION_MS) / DURATION_MS;
    const pos = quadPoint(p, t);
    // Point the nose along the direction of travel
    const ahead = quadPoint(p, Math.min(t + 0.01, 1));
    const angle = (Math.atan2(ahead.y - pos.y, ahead.x - pos.x) * 180) / Math.PI + 90;
    rocket.setAttribute('transform', `translate(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}) rotate(${angle.toFixed(1)})`);
    rocket.setAttribute('opacity', t > 0.97 ? '0' : '1');
    rocketAnim = requestAnimationFrame(frame);
  }
  rocketAnim = requestAnimationFrame(frame);
}

function stopRocketAnimation() {
  if (rocketAnim) cancelAnimationFrame(rocketAnim);
  rocketAnim = null;
}

// ---------- Launch detail cache (full published timeline etc.) ----------

const launchDetailCache = new Map();

async function fetchLaunchDetail(id) {
  if (launchDetailCache.has(id)) return launchDetailCache.get(id);
  try {
    const res = await fetch(`/api/launch?id=${encodeURIComponent(id)}`);
    const payload = await res.json();
    if (!res.ok || payload.error) throw new Error(payload.error || 'detail fetch failed');
    launchDetailCache.set(id, payload.launch);
    return payload.launch;
  } catch (err) {
    console.warn('Launch detail unavailable:', err.message);
    launchDetailCache.set(id, null);
    return null;
  }
}

async function toggleFlightPath(launch, btn) {
  const wasActive = activeFlightPathId === launch.id;
  const domeLoading = document.getElementById('dome-loading');

  document.querySelectorAll('.flightpath-btn.active, .flightpath-btn.is-loading').forEach((b) => {
    b.classList.remove('active', 'is-loading');
    b.disabled = false;
    b.textContent = 'Show flight path';
  });
  if (domeLoading) domeLoading.hidden = true;
  stopRocketAnimation();
  if (typeof pauseReplay === 'function') pauseReplay();

  if (wasActive) {
    activeFlightPathId = null;
    document.getElementById('replay-controls').classList.add('is-idle');
    document.getElementById('stage-card').innerHTML =
      '<div class="detail-empty">Pick a launch below to fly its mission timeline.</div>';
    document.getElementById('replay-timeline').innerHTML = '';
    renderLaunchDome(null);
    return;
  }

  activeFlightPathId = launch.id;
  btn.classList.add('active', 'is-loading');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-spinner"></span>Loading…';
  if (domeLoading) domeLoading.hidden = false;

  // Draw immediately from the list data, then upgrade once the full
  // published timeline arrives.
  renderLaunchDome(launch, null);
  // Scroll the dome into view so a click on a card further down the page
  // (or a rail item) visibly does something right away, spinner included,
  // instead of changing a stage the user can't currently see.
  document.getElementById('launch-dome')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  let detail = null;
  try {
    detail = await fetchLaunchDetail(launch.id);
  } catch (err) {
    console.error(err);
  }
  if (activeFlightPathId !== launch.id) return; // user moved on

  btn.disabled = false;
  btn.classList.remove('is-loading');
  btn.textContent = 'Hide flight path';
  if (domeLoading) domeLoading.hidden = true;
  renderLaunchDome(launch, detail);
  renderMissionBrief(launch, detail);
}

// ---------- Time helpers ----------

// Local wall-clock time at the pad, using the launch site's real IANA zone.
function formatInZone(date, timeZone) {
  if (!date) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone || 'UTC',
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(date) + (timeZone ? ' local' : ' UTC');
  } catch (err) {
    return date.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }
}

function zoneAbbrev(timeZone) {
  if (!timeZone) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(new Date());
    const tz = parts.find((p) => p.type === 'timeZoneName');
    return tz ? tz.value : '';
  } catch (err) {
    return '';
  }
}

// ---------- Mission brief rail ----------

function renderMissionBrief(launch, detail) {
  const el = document.getElementById('mission-brief');
  if (!el) return;

  const d = detail || {};
  const net = launch.net ? new Date(launch.net) : null;
  const tz = d.timezone;

  const row = (k, v) => v ? `<div class="mb-row"><span>${k}</span><strong>${escapeXml(String(v))}</strong></div>` : '';

  const landing = d.landing && d.landing.attempt ? `
    <div class="mb-block">
      <div class="mb-h">Booster recovery</div>
      ${row('Zone', d.landing.zoneName)}
      ${row('Type', d.landing.typeName)}
      ${row('Downrange', d.landing.downrangeKm != null ? `${Math.round(d.landing.downrangeKm)} km` : null)}
      ${d.landing.success === true ? '<div class="mb-tag ok">Landing successful</div>'
        : d.landing.success === false ? '<div class="mb-tag bad">Landing failed</div>'
        : '<div class="mb-tag">Landing planned</div>'}
    </div>` : '';

  const booster = d.booster ? `
    <div class="mb-block">
      <div class="mb-h">Booster</div>
      ${row('Serial', d.booster.serial)}
      ${row('Flight #', d.booster.flightNumber)}
      ${row('Reused', d.booster.reused ? 'Yes' : 'No')}
      ${row('Landings', d.booster.successfulLandings)}
    </div>` : '';

  el.innerHTML = `
    <div class="mb-title">${escapeXml(launch.name || '')}</div>
    <div class="mb-block">
      <div class="mb-h">Timing</div>
      ${row('UTC', net ? net.toISOString().slice(0, 16).replace('T', ' ') : 'TBD')}
      ${row(`Local${zoneAbbrev(tz) ? ' (' + zoneAbbrev(tz) + ')' : ''}`, net && tz ? formatInZone(net, tz) : null)}
      ${row('Countdown', net ? formatCountdown(launch.net) : null)}
    </div>
    <div class="mb-block">
      <div class="mb-h">Vehicle</div>
      ${row('Rocket', d.rocket || launch.rocket)}
      ${row('Height', d.specs && d.specs.lengthM ? `${d.specs.lengthM} m` : null)}
      ${row('Thrust', d.specs && d.specs.thrustKN ? `${Math.round(d.specs.thrustKN).toLocaleString()} kN` : null)}
      ${row('LEO payload', d.specs && d.specs.leoCapacityKg ? `${Math.round(d.specs.leoCapacityKg).toLocaleString()} kg` : null)}
      ${row('Reusable', d.specs && d.specs.reusable != null ? (d.specs.reusable ? 'Yes' : 'No') : null)}
    </div>
    ${booster}
    ${landing}
    <button class="refresh-btn" id="mb-details">Full mission details ▸</button>
  `;

  const btn = document.getElementById('mb-details');
  if (btn) btn.addEventListener('click', () => openLaunchDrawer(launch));
}

function handleFlightPathClick(e) {
  const detailsBtn = e.target.closest('.details-btn');
  if (detailsBtn) {
    const l = launchesById.get(detailsBtn.dataset.details);
    if (l) openLaunchDrawer(l);
    return;
  }

  const btn = e.target.closest('.flightpath-btn');
  if (!btn || btn.disabled) return;
  const launch = launchesById.get(btn.dataset.id);
  if (!launch) return;
  toggleFlightPath(launch, btn);
}

document.getElementById('launches-upcoming').addEventListener('click', handleFlightPathClick);
document.getElementById('launches-recent').addEventListener('click', handleFlightPathClick);

// ---------- Mode toggle ----------

// Launches leads — it's the most engaging entry point into the app.
const MODES = {
  launches: { btn: 'mode-launches-btn', view: 'launches-view', showTabs: false },
  tracker: { btn: 'mode-tracker-btn', view: 'tracker-view', showTabs: true },
  mission: { btn: 'mode-mission-btn', view: 'mission-view', showTabs: false },
};

// The mega-menu dropdowns open on CSS :hover/:focus-within. Clicking a nav
// button or a link inside its dropdown leaves that button focused, which
// keeps :focus-within (and therefore the dropdown) open until focus moves
// elsewhere — it doesn't, since navigating away doesn't move the mouse or
// blur anything on its own. Force it closed here instead of waiting on that.
function closeNavDropdowns() {
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.add('force-closed');
    const clear = () => item.classList.remove('force-closed');
    item.addEventListener('mouseleave', clear, { once: true });
    setTimeout(clear, 1200);
  });
}

function switchMode(mode) {
  const cfg = MODES[mode];
  if (!cfg) return;

  closeNavDropdowns();

  for (const [name, m] of Object.entries(MODES)) {
    document.getElementById(m.btn).classList.toggle('active', name === mode);
    const view = document.getElementById(m.view);
    view.hidden = name !== mode;
    if (name === mode) {
      view.classList.remove('view-enter');
      void view.offsetWidth; // restart the transition
      view.classList.add('view-enter');
    }
  }

  document.getElementById('tab-bar').style.display = cfg.showTabs ? '' : 'none';

  if (mode === 'tracker') {
    // Leaflet miscalculates its size while its container is display:none —
    // nudge it once it's visible again.
    setTimeout(() => map.invalidateSize(), 60);
  } else if (mode === 'launches') {
    renderLaunchDome(null);
    refreshLaunchesView();
  } else if (mode === 'mission') {
    refreshMissionControl();
  }
}

function initModeToggle() {
  for (const [name, m] of Object.entries(MODES)) {
    document.getElementById(m.btn).addEventListener('click', () => {
      // A deliberate top-level nav click means the user is moving on from
      // wherever a quicklink took them — the "back to that" offer goes stale.
      hideBackButton();
      switchMode(name);
    });
  }
}

// ---------- "Back to where that quicklink came from" ----------
// The whole app is one page — nothing reloads when you jump between
// sections, which is the point (see initNavDropdowns below), but it also
// means the browser's own back button has nothing to do. This is a
// same-page substitute: one step of history, captured right before a
// quicklink jumps you somewhere, offered back for a little while after.

let backLocation = null;
let backHideTimer = null;

const TRACKER_SUBVIEWS = [
  { btn: 'view-map-btn', label: 'Map' },
  { btn: 'view-dome-btn', label: 'Dome' },
  { btn: 'view-horizon-btn', label: 'Horizon' },
];

function captureLocation() {
  const modeName = Object.keys(MODES).find((m) => !document.getElementById(MODES[m].view).hidden);
  if (!modeName) return null;
  const cfg = MODES[modeName];
  const viewEl = document.getElementById(cfg.view);
  const scrollTop = viewEl.scrollTop;
  const baseLabel = { launches: 'Launches', tracker: 'Satellites', mission: 'Mission Control' }[modeName];

  let label = baseLabel;
  let sub = null;
  if (modeName === 'tracker') {
    sub = TRACKER_SUBVIEWS.find((v) => document.getElementById(v.btn).classList.contains('active'));
    if (sub) label = `${baseLabel} · ${sub.label}`;
  }

  return {
    label,
    restore() {
      switchMode(modeName);
      if (sub) document.getElementById(sub.btn).click();
      // The view's content re-populates async (launch lists, mission
      // control, etc.) — nudge the scroll position again once it has.
      const applyScroll = () => { viewEl.scrollTop = scrollTop; };
      requestAnimationFrame(applyScroll);
      setTimeout(applyScroll, 150);
    },
  };
}

function showBackButton(loc) {
  if (!loc) return;
  backLocation = loc;
  const btn = document.getElementById('nav-back-btn');
  if (!btn) return;
  document.getElementById('nav-back-label').textContent = loc.label;
  btn.hidden = false;
  void btn.offsetWidth;
  btn.classList.add('show');
  clearTimeout(backHideTimer);
  backHideTimer = setTimeout(hideBackButton, 9000);
}

function hideBackButton() {
  clearTimeout(backHideTimer);
  backLocation = null;
  const btn = document.getElementById('nav-back-btn');
  if (btn) btn.classList.remove('show');
}

function initBackButton() {
  const btn = document.getElementById('nav-back-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const loc = backLocation;
    hideBackButton();
    if (loc) loc.restore();
  });
  document.getElementById('nav-back-dismiss').addEventListener('click', (e) => {
    e.stopPropagation();
    hideBackButton();
  });
  btn.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'opacity' && !btn.classList.contains('show')) btn.hidden = true;
  });
}

// ---------- Nav mega-menu quick links ----------

function initNavDropdowns() {
  const wire = (id, fn) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const loc = captureLocation();
      fn();
      showBackButton(loc);
    });
  };

  wire('nav-link-upcoming', () => {
    switchMode('launches');
    document.getElementById('launches-upcoming').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  wire('nav-link-recent', () => {
    switchMode('launches');
    document.getElementById('launches-recent').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  wire('nav-link-map', () => { switchMode('tracker'); document.getElementById('view-map-btn').click(); });
  wire('nav-link-dome', () => { switchMode('tracker'); document.getElementById('view-dome-btn').click(); });
  wire('nav-link-horizon', () => { switchMode('tracker'); document.getElementById('view-horizon-btn').click(); });
  wire('nav-link-legend', () => {
    switchMode('tracker');
    const legend = document.getElementById('map-legend');
    if (legend && legend.classList.contains('collapsed')) {
      document.getElementById('legend-toggle')?.click();
    }
  });

  wire('nav-link-schedule', () => {
    switchMode('mission');
    setTimeout(() => document.getElementById('mc-schedule')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  });
  wire('nav-link-catalogue', () => {
    switchMode('mission');
    setTimeout(() => document.getElementById('mc-catalogue')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  });
}
