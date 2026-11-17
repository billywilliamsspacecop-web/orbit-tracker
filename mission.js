// mission.js — the Mission Control dashboard: everything at a glance.
// Reads from the same in-memory state the tracker and launches views use, so
// it never issues duplicate satellite requests; it only needs the launch feed.

let mcCharts = { orbit: null, group: null, cadence: null };
let mcCountdownTimer = null;

function mcInitCharts() {
  if (mcCharts.orbit) return;

  const axis = {
    x: { ticks: { color: '#5b5340', font: { size: 10 } }, grid: { color: '#cdb98a' } },
    y: { ticks: { color: '#5b5340' }, grid: { color: '#cdb98a' }, beginAtZero: true },
  };

  mcCharts.orbit = new Chart(document.getElementById('mc-orbit-chart'), {
    type: 'bar',
    data: {
      labels: [['LEO', '<2,000km'], ['MEO', '2k–35k'], ['GEO', '~35,786km'], ['HEO', '>36.5k']],
      datasets: [{ data: [0, 0, 0, 0], backgroundColor: ['#4d74a6', '#3f8f8a', '#b8503f', '#b8822c'], borderRadius: 4 }],
    },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: axis },
  });

  mcCharts.group = new Chart(document.getElementById('mc-group-chart'), {
    type: 'doughnut',
    data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderWidth: 0 }] },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { color: '#5b5340', boxWidth: 10, font: { size: 10 } } } },
    },
  });

  mcCharts.cadence = new Chart(document.getElementById('mc-cadence-chart'), {
    type: 'bar',
    data: { labels: [], datasets: [{ data: [], backgroundColor: '#b8503f', borderRadius: 4 }] },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: { legend: { display: false } },
      scales: axis,
    },
  });
}

function mcRenderKPIs() {
  const el = document.getElementById('mc-kpis');
  if (!el) return;

  let leo = 0, meo = 0, geo = 0, heo = 0, total = 0, named = 0;
  for (const g of GROUPS) {
    const bucket = state.groups.get(g.id);
    if (!bucket.loaded) continue;
    for (const s of bucket.sats) {
      total++;
      if (s.known) named++;
      const a = s.lastAlt;
      if (a == null) continue;
      if (a < 2000) leo++;
      else if (a < 35000) meo++;
      else if (a <= 36500) geo++;
      else heo++;
    }
  }

  const kpis = [
    { k: 'Objects tracked', v: total, c: 'var(--cyan)' },
    { k: 'In LEO', v: leo, c: 'var(--green)' },
    { k: 'In MEO', v: meo, c: 'var(--amber)' },
    { k: 'GEO belt', v: geo, c: 'var(--purple)' },
    { k: 'Named objects', v: named, c: 'var(--magenta)' },
    { k: 'Groups loaded', v: `${GROUPS.filter((g) => state.groups.get(g.id).loaded).length}/${GROUPS.length}`, c: 'var(--cyan)' },
  ];

  el.innerHTML = kpis.map((x) => `
    <div class="kpi">
      <div class="kpi-v" style="color:${x.c}">${x.v}</div>
      <div class="kpi-k">${x.k}</div>
    </div>`).join('');
}

function mcRenderCharts() {
  mcInitCharts();

  const buckets = [0, 0, 0, 0];
  const groupLabels = [];
  const groupCounts = [];
  const groupColors = [];

  for (const g of GROUPS) {
    const bucket = state.groups.get(g.id);
    if (!bucket.loaded) continue;
    groupLabels.push(g.label);
    groupCounts.push(bucket.sats.length);
    groupColors.push(g.color);
    for (const s of bucket.sats) {
      const a = s.lastAlt;
      if (a == null) continue;
      if (a < 2000) buckets[0]++;
      else if (a < 35000) buckets[1]++;
      else if (a <= 36500) buckets[2]++;
      else buckets[3]++;
    }
  }

  mcCharts.orbit.data.datasets[0].data = buckets;
  mcCharts.orbit.update();

  mcCharts.group.data.labels = groupLabels;
  mcCharts.group.data.datasets[0].data = groupCounts;
  mcCharts.group.data.datasets[0].backgroundColor = groupColors;
  mcCharts.group.update();
}

function mcRenderCadence(launches) {
  mcInitCharts();
  const counts = new Map();
  for (const l of launches) {
    const key = l.providerAbbrev || l.provider || 'Unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  mcCharts.cadence.data.labels = sorted.map((x) => x[0]);
  mcCharts.cadence.data.datasets[0].data = sorted.map((x) => x[1]);
  mcCharts.cadence.update();
}

function mcRenderNextLaunch(l) {
  const el = document.getElementById('mc-next-launch');
  if (!el) return;
  if (!l) {
    el.innerHTML = '<div class="detail-empty">No upcoming launches in the feed.</div>';
    return;
  }

  const cls = statusClass(l.statusAbbrev);
  el.innerHTML = `
    <div class="mc-next">
      <div class="mc-next-count" id="mc-countdown">—</div>
      <div class="mc-next-name">${escapeXml(l.name || '—')}</div>
      <div class="mc-next-meta">
        ${escapeXml(l.rocket || '—')} · ${escapeXml(l.provider || '—')}<br>
        ${escapeXml(l.location || l.pad || '—')}<br>
        ${l.net ? escapeXml(new Date(l.net).toISOString().slice(0, 16).replace('T', ' ')) + ' UTC' : 'Date TBD'}
      </div>
      <div class="mc-next-badges">
        <span class="launch-status ${cls}">${escapeXml(l.statusName || l.statusAbbrev || '—')}</span>
        ${l.orbit ? `<span class="ld-chip">${escapeXml(l.orbit)}</span>` : ''}
      </div>
      <button class="refresh-btn" id="mc-next-details">View mission details ▸</button>
    </div>
  `;

  const btn = document.getElementById('mc-next-details');
  if (btn) btn.addEventListener('click', () => openLaunchDrawer({ ...l, upcoming: true }));

  // Live-ticking countdown
  if (mcCountdownTimer) clearInterval(mcCountdownTimer);
  const paint = () => {
    const node = document.getElementById('mc-countdown');
    if (!node) return clearInterval(mcCountdownTimer);
    if (!l.net) { node.textContent = 'TBD'; return; }
    const diff = new Date(l.net) - new Date();
    const past = diff < 0;
    const abs = Math.abs(diff);
    const d = Math.floor(abs / 86400000);
    const h = Math.floor((abs % 86400000) / 3600000);
    const m = Math.floor((abs % 3600000) / 60000);
    const s = Math.floor((abs % 60000) / 1000);
    node.textContent = `${past ? 'T+' : 'T−'}${d ? d + 'd ' : ''}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    node.classList.toggle('is-past', past);
  };
  paint();
  mcCountdownTimer = setInterval(paint, 1000);

  // HUD in the header
  const hud = document.getElementById('hud-next');
  if (hud) hud.textContent = l.rocket || l.name || '—';
}

function mcRenderSchedule(launches) {
  const el = document.getElementById('mc-schedule');
  if (!el) return;
  if (!launches.length) {
    el.innerHTML = '<div class="detail-empty">No scheduled launches available.</div>';
    return;
  }

  el.innerHTML = `
    <table class="mc-table">
      <thead><tr><th>When (UTC)</th><th>Vehicle</th><th>Mission</th><th>Site</th><th>Orbit</th><th>Status</th></tr></thead>
      <tbody>
        ${launches.slice(0, 10).map((l) => `
          <tr data-details="${escapeXml(l.id)}">
            <td class="mono">${l.net ? escapeXml(new Date(l.net).toISOString().slice(0, 16).replace('T', ' ')) : 'TBD'}</td>
            <td>${escapeXml(l.rocket || '—')}</td>
            <td>${escapeXml(l.mission || l.name || '—')}</td>
            <td>${escapeXml(l.location || l.pad || '—')}</td>
            <td>${escapeXml(l.orbit || '—')}</td>
            <td><span class="launch-status ${statusClass(l.statusAbbrev)}">${escapeXml(l.statusAbbrev || '—')}</span></td>
          </tr>`).join('')}
      </tbody>
    </table>
    <div class="meta">Click any row for full mission details.</div>
  `;

  el.querySelectorAll('tr[data-details]').forEach((row) => {
    row.addEventListener('click', () => {
      const l = launchesById.get(row.dataset.details);
      if (l) openLaunchDrawer(l);
    });
  });
}

function mcRenderExtremes() {
  const el = document.getElementById('mc-extremes');
  if (!el) return;

  let highest = null, lowest = null, fastest = null;
  for (const g of GROUPS) {
    const bucket = state.groups.get(g.id);
    if (!bucket.loaded) continue;
    for (const s of bucket.sats) {
      if (s.lastAlt == null) continue;
      if (!highest || s.lastAlt > highest.lastAlt) highest = s;
      if (!lowest || s.lastAlt < lowest.lastAlt) lowest = s;
      const revPerDay = 1440 / ((2 * Math.PI) / s.satrec.no);
      s._revday = revPerDay;
      if (!fastest || revPerDay > fastest._revday) fastest = s;
    }
  }

  if (!highest) {
    el.innerHTML = '<div class="detail-empty">Waiting for propagation…</div>';
    return;
  }

  const card = (label, s, valueText, color) => `
    <div class="ex-card" style="--exc:${color}">
      <div class="ex-label">${label}</div>
      <div class="ex-name">${escapeXml(s.name)}</div>
      <div class="ex-val">${valueText}</div>
    </div>`;

  el.innerHTML = `
    <div class="ex-row">
      ${card('Highest altitude', highest, `${Math.round(highest.lastAlt).toLocaleString()} km`, 'var(--purple)')}
      ${card('Lowest altitude', lowest, `${Math.round(lowest.lastAlt).toLocaleString()} km`, 'var(--green)')}
      ${card('Most orbits / day', fastest, `${fastest._revday.toFixed(2)} rev/day`, 'var(--cyan)')}
    </div>`;
}

// ---------- Orbit glossary (full names, not just abbreviations) ----------

const ORBIT_GLOSSARY = [
  { abbrev: 'LEO', full: 'Low Earth Orbit', alt: '160 – 2,000 km', period: '~90 min',
    note: 'Where the ISS, Starlink and most Earth-imaging satellites live. Fast, close, small footprint each — so you need many of them for continuous coverage.' },
  { abbrev: 'MEO', full: 'Medium Earth Orbit', alt: '2,000 – 35,000 km', period: '2 – 12 hrs',
    note: 'Navigation territory. GPS sits near 20,200 km, high enough that a handful of satellites cover the whole planet.' },
  { abbrev: 'GEO', full: 'Geostationary Orbit', alt: '35,786 km', period: '23 h 56 m',
    note: 'Orbits once per sidereal day above the equator, so it appears fixed in the sky. Used by TV, weather and comsats — you can aim a dish once and leave it.' },
  { abbrev: 'GSO', full: 'Geosynchronous Orbit', alt: '35,786 km', period: '23 h 56 m',
    note: 'Same period as GEO but inclined, so it traces a figure-of-eight rather than holding a fixed point.' },
  { abbrev: 'HEO', full: 'Highly Elliptical Orbit', alt: 'varies, apogee >36,500 km', period: '~12 hrs',
    note: 'Long looping orbits that dwell over high latitudes — coverage GEO cannot reach because it sits over the equator.' },
  { abbrev: 'SSO', full: 'Sun-Synchronous Orbit', alt: '~600 – 800 km', period: '~98 min',
    note: 'A near-polar LEO whose plane precesses with the seasons, so it crosses the equator at the same local solar time each pass — consistent lighting for imaging.' },
  { abbrev: 'GTO', full: 'Geostationary Transfer Orbit', alt: 'ellipse up to ~35,786 km', period: '~10.5 hrs',
    note: 'A temporary staging ellipse. The satellite circularises at apogee to reach GEO.' },
  { abbrev: 'PO', full: 'Polar Orbit', alt: 'typically LEO', period: '~100 min',
    note: 'Passes near both poles, so the rotating Earth eventually presents every point on the surface.' },
];

function mcRenderGlossary() {
  const el = document.getElementById('mc-glossary');
  if (!el) return;
  el.innerHTML = `
    <div class="gloss-grid">
      ${ORBIT_GLOSSARY.map((g) => `
        <div class="gloss">
          <div class="gloss-h"><strong>${escapeXml(g.full)}</strong><span class="gloss-ab">${escapeXml(g.abbrev)}</span></div>
          <div class="gloss-meta">${escapeXml(g.alt)} · period ${escapeXml(g.period)}</div>
          <div class="gloss-note">${escapeXml(g.note)}</div>
        </div>`).join('')}
    </div>`;
}

// ---------- Leaderboards ----------

function mcRankList(containerId, entries, unit) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!entries.length) {
    el.innerHTML = '<div class="detail-empty">No data available.</div>';
    return;
  }
  const max = entries[0][1];
  el.innerHTML = entries.slice(0, 8).map(([name, n]) => `
    <div class="rank-row">
      <span class="rank-name" title="${escapeXml(name)}">${escapeXml(name)}</span>
      <span class="rank-bar"><span class="rank-fill" style="width:${((n / max) * 100).toFixed(1)}%"></span></span>
      <span class="rank-n">${n}${unit || ''}</span>
    </div>`).join('');
}

function mcRenderLeaderboards(launches) {
  const bySite = new Map();
  const byCountry = new Map();
  for (const l of launches) {
    const site = l.location || l.pad;
    if (site) bySite.set(site, (bySite.get(site) || 0) + 1);
    const c = l.provider;
    if (c) byCountry.set(c, (byCountry.get(c) || 0) + 1);
  }
  mcRankList('mc-sites', [...bySite.entries()].sort((a, b) => b[1] - a[1]));
  mcRankList('mc-countries', [...byCountry.entries()].sort((a, b) => b[1] - a[1]));
}

// ---------- Extra charts ----------

let mcCharts2 = { missionType: null, incl: null, decade: null, period: null };

function mcInitCharts2() {
  if (mcCharts2.missionType) return;
  const axis = {
    x: { ticks: { color: '#5b5340', font: { size: 9 } }, grid: { color: '#cdb98a' } },
    y: { ticks: { color: '#5b5340' }, grid: { color: '#cdb98a' }, beginAtZero: true },
  };

  mcCharts2.missionType = new Chart(document.getElementById('mc-missiontype-chart'), {
    type: 'doughnut',
    data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderWidth: 0 }] },
    options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { color: '#5b5340', boxWidth: 9, font: { size: 9 } } } } },
  });

  mcCharts2.incl = new Chart(document.getElementById('mc-incl-chart'), {
    type: 'bar',
    data: {
      labels: [['Equatorial', '0–20°'], ['Mid', '20–50°'], ['High', '50–80°'], ['Polar', '80–100°'], ['Retrograde', '>100°']],
      datasets: [{ data: [0, 0, 0, 0, 0], backgroundColor: '#4d74a6', borderRadius: 4 }],
    },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: axis },
  });

  mcCharts2.decade = new Chart(document.getElementById('mc-decade-chart'), {
    type: 'bar',
    data: { labels: [], datasets: [{ data: [], backgroundColor: '#3f8f8a', borderRadius: 4 }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: axis },
  });

  mcCharts2.period = new Chart(document.getElementById('mc-period-chart'), {
    type: 'bar',
    data: {
      labels: [['<90', 'min'], ['90–100', 'min'], ['100–130', 'min'], ['2–12', 'hrs'], ['>12', 'hrs']],
      datasets: [{ data: [0, 0, 0, 0, 0], backgroundColor: '#b8503f', borderRadius: 4 }],
    },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: axis },
  });
}

function mcRenderExtraCharts(launches) {
  mcInitCharts2();

  // Mission types from the launch feed
  const types = new Map();
  for (const l of launches) {
    const t = l.missionType || 'Unknown';
    types.set(t, (types.get(t) || 0) + 1);
  }
  const palette = ['#4d74a6', '#3f8f8a', '#b8503f', '#b8822c', '#8a5a7a', '#6e8f5c', '#5b5340'];
  const sortedTypes = [...types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
  mcCharts2.missionType.data.labels = sortedTypes.map((x) => x[0]);
  mcCharts2.missionType.data.datasets[0].data = sortedTypes.map((x) => x[1]);
  mcCharts2.missionType.data.datasets[0].backgroundColor = sortedTypes.map((_, i) => palette[i % palette.length]);
  mcCharts2.missionType.update();

  // Satellite-derived distributions
  const incl = [0, 0, 0, 0, 0];
  const decades = new Map();
  const periods = [0, 0, 0, 0, 0];

  for (const g of GROUPS) {
    const bucket = state.groups.get(g.id);
    if (!bucket.loaded) continue;
    for (const s of bucket.sats) {
      const i = (s.satrec.inclo * 180) / Math.PI;
      if (i < 20) incl[0]++;
      else if (i < 50) incl[1]++;
      else if (i < 80) incl[2]++;
      else if (i < 100) incl[3]++;
      else incl[4]++;

      const pMin = (2 * Math.PI) / s.satrec.no;
      if (pMin < 90) periods[0]++;
      else if (pMin < 100) periods[1]++;
      else if (pMin < 130) periods[2]++;
      else if (pMin < 720) periods[3]++;
      else periods[4]++;

      const d = parseDesignator(s.line1);
      if (d && d.yearFull) {
        const dec = `${Math.floor(d.yearFull / 10) * 10}s`;
        decades.set(dec, (decades.get(dec) || 0) + 1);
      }
    }
  }

  mcCharts2.incl.data.datasets[0].data = incl;
  mcCharts2.incl.update();

  mcCharts2.period.data.datasets[0].data = periods;
  mcCharts2.period.update();

  const sortedDec = [...decades.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  mcCharts2.decade.data.labels = sortedDec.map((x) => x[0]);
  mcCharts2.decade.data.datasets[0].data = sortedDec.map((x) => x[1]);
  mcCharts2.decade.update();
}

// ---------- Object catalogue (searchable, sortable, clickable) ----------

let catalogueSort = 'alt-desc';
let catalogueQuery = '';

function mcRenderCatalogue() {
  const el = document.getElementById('mc-catalogue');
  if (!el) return;

  let rows = [];
  for (const g of GROUPS) {
    const bucket = state.groups.get(g.id);
    if (!bucket.loaded) continue;
    for (const s of bucket.sats) {
      if (s.lastAlt == null) continue;
      const d = parseDesignator(s.line1);
      rows.push({
        sat: s,
        name: s.name,
        norad: s.noradId,
        group: g.label,
        color: g.color,
        alt: s.lastAlt,
        incl: (s.satrec.inclo * 180) / Math.PI,
        period: (2 * Math.PI) / s.satrec.no,
        year: d && d.yearFull ? d.yearFull : null,
      });
    }
  }

  if (catalogueQuery) {
    const q = catalogueQuery.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(q) || String(r.norad).includes(q));
  }

  const sorters = {
    'alt-desc': (a, b) => b.alt - a.alt,
    'alt-asc': (a, b) => a.alt - b.alt,
    'name': (a, b) => a.name.localeCompare(b.name),
    'incl-desc': (a, b) => b.incl - a.incl,
    'period-asc': (a, b) => a.period - b.period,
    'launch-desc': (a, b) => (b.year || 0) - (a.year || 0),
  };
  rows.sort(sorters[catalogueSort] || sorters['alt-desc']);

  const shown = rows.slice(0, 60);
  if (!shown.length) {
    el.innerHTML = '<div class="detail-empty">No objects match that search.</div>';
    return;
  }

  el.innerHTML = `
    <div class="mc-scroll">
      <table class="mc-table">
        <thead><tr><th>Object</th><th>NORAD</th><th>Group</th><th>Altitude</th><th>Inclination</th><th>Period</th><th>Launched</th></tr></thead>
        <tbody>
          ${shown.map((r) => `
            <tr data-norad="${escapeXml(r.norad)}">
              <td><span class="cat-dot" style="background:${r.color}"></span>${escapeXml(r.name)}</td>
              <td class="mono">${escapeXml(r.norad)}</td>
              <td class="mono">${escapeXml(r.group)}</td>
              <td class="mono">${Math.round(r.alt).toLocaleString()} km</td>
              <td class="mono">${r.incl.toFixed(1)}°</td>
              <td class="mono">${r.period.toFixed(0)} min</td>
              <td class="mono">${r.year || '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="meta">Showing ${shown.length} of ${rows.length} tracked objects.</div>`;

  el.querySelectorAll('tr[data-norad]').forEach((row) => {
    row.addEventListener('click', () => {
      const found = shown.find((r) => r.norad === row.dataset.norad);
      if (!found) return;
      selectSatellite(found.sat);
      switchMode('tracker');
      if (found.sat.lastLat != null) map.setView([found.sat.lastLat, found.sat.lastLon], 4);
    });
  });
}

function mcInitCatalogueControls() {
  const search = document.getElementById('mc-cat-search');
  const sort = document.getElementById('mc-cat-sort');
  if (search && !search.dataset.wired) {
    search.dataset.wired = '1';
    search.addEventListener('input', () => { catalogueQuery = search.value.trim(); mcRenderCatalogue(); });
  }
  if (sort && !sort.dataset.wired) {
    sort.dataset.wired = '1';
    sort.addEventListener('change', () => { catalogueSort = sort.value; mcRenderCatalogue(); });
  }
}

// ---------- Activity feed ----------

function mcRenderActivity(launches) {
  const el = document.getElementById('mc-activity');
  if (!el) return;

  const items = launches
    .filter((l) => l.net)
    .sort((a, b) => new Date(b.net) - new Date(a.net))
    .slice(0, 12);

  if (!items.length) {
    el.innerHTML = '<div class="detail-empty">No recent activity.</div>';
    return;
  }

  el.innerHTML = `<div class="feed">${items.map((l) => {
    const when = new Date(l.net);
    const past = when < new Date();
    return `
      <div class="feed-item" data-details="${escapeXml(l.id)}">
        <span class="feed-dot ${statusClass(l.statusAbbrev)}"></span>
        <div class="feed-body">
          <div class="feed-title">${escapeXml(l.name || '')}</div>
          <div class="feed-meta">${escapeXml(l.provider || '')} · ${escapeXml(l.location || l.pad || '')}</div>
        </div>
        <div class="feed-when">${past ? 'T+' : 'T−'}${formatCountdown(l.net).replace(/^T-(minus|plus) /, '')}</div>
      </div>`;
  }).join('')}</div>`;

  el.querySelectorAll('.feed-item').forEach((it) => {
    it.addEventListener('click', () => {
      const l = launchesById.get(it.dataset.details);
      if (l) openLaunchDrawer(l);
    });
  });
}

async function refreshMissionControl() {
  mcRenderKPIs();
  mcRenderCharts();
  mcRenderExtremes();
  mcRenderGlossary();
  mcInitCatalogueControls();
  mcRenderCatalogue();

  try {
    const data = await ensureLaunchesData();
    // Cache launches so drawer lookups from the schedule table work
    data.upcoming.forEach((l) => launchesById.set(l.id, { ...l, upcoming: true }));
    data.previous.forEach((l) => launchesById.set(l.id, { ...l, upcoming: false }));

    const all = [...data.previous, ...data.upcoming];
    const next = data.upcoming[0];
    mcRenderNextLaunch(next);
    mcRenderSchedule(data.upcoming);
    mcRenderCadence(all);
    mcRenderLeaderboards(all);
    mcRenderExtraCharts(all);
    mcRenderActivity(all);

    if (next && next.padLat != null) {
      renderWeatherInto('mc-weather', next.padLat, next.padLon, next.location || next.pad);
    } else {
      document.getElementById('mc-weather').innerHTML =
        '<div class="detail-empty">No pad coordinates published for the next launch.</div>';
    }
  } catch (err) {
    console.error(err);
    document.getElementById('mc-next-launch').innerHTML = '<div class="detail-empty">Could not load launch feed.</div>';
    document.getElementById('mc-schedule').innerHTML = '<div class="detail-empty">Could not load launch feed.</div>';
    document.getElementById('mc-weather').innerHTML = '<div class="detail-empty">Weather needs the launch feed.</div>';
  }
}
