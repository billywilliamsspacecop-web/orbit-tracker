// diagrams.js — simple explanatory diagrams generated from each satellite's
// real orbital elements, shown alongside the NASA photos.
//
// Every number in these is derived from the object's own TLE (or standard
// physical constants) — nothing is decorative filler.

const EARTH_R_KM = 6378.137;

// ---------- 1. Orbit profile: the ellipse, to scale, against Earth ----------

function diagramOrbitProfile(sat) {
  const satrec = sat.satrec;
  const periodMin = (2 * Math.PI) / satrec.no;
  const a = Math.cbrt(398600.4418 * Math.pow((periodMin * 60) / (2 * Math.PI), 2)); // semi-major axis
  const e = satrec.ecco;
  const b = a * Math.sqrt(1 - e * e);
  const apogee = a * (1 + e) - EARTH_R_KM;
  const perigee = a * (1 - e) - EARTH_R_KM;

  const W = 300, H = 190;
  const scale = Math.min((W * 0.42) / a, (H * 0.42) / b);
  const cx = W / 2 + a * e * scale; // Earth sits at a focus, not the centre
  const cy = H / 2;
  const er = Math.max(EARTH_R_KM * scale, 5);

  return `
    <figure class="dg">
      <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="${(W / 2).toFixed(1)}" cy="${cy}" rx="${(a * scale).toFixed(1)}" ry="${(b * scale).toFixed(1)}"
                 class="dg-orbit" />
        <circle cx="${cx.toFixed(1)}" cy="${cy}" r="${er.toFixed(1)}" class="dg-earth" />
        <circle cx="${(cx - er - 3).toFixed(1)}" cy="${cy}" r="2.6" class="dg-sat" />
        <text x="6" y="14" class="dg-label">Apogee ${Math.round(apogee).toLocaleString()} km</text>
        <text x="6" y="${H - 6}" class="dg-label">Perigee ${Math.round(perigee).toLocaleString()} km</text>
        <text x="${W - 6}" y="14" text-anchor="end" class="dg-label">e = ${e.toFixed(4)}</text>
        <text x="${W - 6}" y="${H - 6}" text-anchor="end" class="dg-label">Period ${periodMin.toFixed(0)} min</text>
      </svg>
      <figcaption>Orbit shape to scale. Earth sits at one focus of the ellipse — that offset is why apogee and perigee differ.</figcaption>
    </figure>`;
}

// ---------- 2. Altitude ladder: where this object sits vs known references ----------

const ALT_REFERENCES = [
  { name: 'Commercial aircraft', km: 12 },
  { name: 'Kármán line (space)', km: 100 },
  { name: 'ISS', km: 420 },
  { name: 'Hubble', km: 535 },
  { name: 'Starlink shell', km: 550 },
  { name: 'GPS constellation', km: 20200 },
  { name: 'Geostationary belt', km: 35786 },
];

function diagramAltitudeLadder(sat) {
  const alt = sat.lastAlt;
  if (alt == null) return '';

  const W = 300, H = 210;
  const maxKm = Math.max(alt * 1.15, 40000);
  // Log scale, or everything below GEO collapses into one line
  const toY = (km) => {
    const lo = Math.log10(10), hi = Math.log10(maxKm);
    const f = (Math.log10(Math.max(km, 10)) - lo) / (hi - lo);
    return H - 22 - f * (H - 44);
  };

  const refs = ALT_REFERENCES.filter((r) => r.km <= maxKm).map((r) => `
    <line x1="52" y1="${toY(r.km).toFixed(1)}" x2="${W - 8}" y2="${toY(r.km).toFixed(1)}" class="dg-ref-line" />
    <text x="56" y="${(toY(r.km) - 3).toFixed(1)}" class="dg-label dim">${escapeXml(r.name)} · ${r.km.toLocaleString()} km</text>
  `).join('');

  return `
    <figure class="dg">
      <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        <rect x="8" y="${H - 22}" width="${W - 16}" height="14" class="dg-ground" />
        <text x="12" y="${H - 12}" class="dg-label">Earth's surface</text>
        ${refs}
        <line x1="52" y1="${toY(alt).toFixed(1)}" x2="${W - 8}" y2="${toY(alt).toFixed(1)}" class="dg-here-line" />
        <circle cx="52" cy="${toY(alt).toFixed(1)}" r="4" class="dg-sat" />
        <text x="56" y="${(toY(alt) - 5).toFixed(1)}" class="dg-label hot">${escapeXml(sat.name)} · ${Math.round(alt).toLocaleString()} km</text>
      </svg>
      <figcaption>Altitude on a logarithmic scale against familiar reference points. Log scale is needed or everything below geostationary collapses together.</figcaption>
    </figure>`;
}

// ---------- 3. Inclination: how far north/south the ground track reaches ----------

function diagramInclination(sat) {
  const inc = (sat.satrec.inclo * 180) / Math.PI;
  const reach = Math.min(inc > 90 ? 180 - inc : inc, 90); // retrograde orbits mirror

  const W = 300, H = 170;
  const cx = W / 2, cy = H / 2, r = 62;
  const yTop = cy - r * (reach / 90);
  const yBot = cy + r * (reach / 90);

  return `
    <figure class="dg">
      <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        <circle cx="${cx}" cy="${cy}" r="${r}" class="dg-earth-outline" />
        <rect x="${cx - r}" y="${yTop.toFixed(1)}" width="${r * 2}" height="${(yBot - yTop).toFixed(1)}" class="dg-coverage" />
        <line x1="${cx - r}" y1="${cy}" x2="${cx + r}" y2="${cy}" class="dg-ref-line" />
        <text x="${cx + r + 6}" y="${cy + 3}" class="dg-label dim">Equator</text>
        <text x="${cx + r + 6}" y="${yTop.toFixed(1)}" class="dg-label">${reach.toFixed(1)}°N</text>
        <text x="${cx + r + 6}" y="${yBot.toFixed(1)}" class="dg-label">${reach.toFixed(1)}°S</text>
        <text x="8" y="16" class="dg-label hot">Inclination ${inc.toFixed(2)}°</text>
        ${inc > 90 ? `<text x="8" y="${H - 8}" class="dg-label dim">Retrograde — orbits against Earth's spin</text>` : ''}
      </svg>
      <figcaption>Shaded band is the latitude range this orbit can ever pass over. It never flies above ${reach.toFixed(1)}° north or south.</figcaption>
    </figure>`;
}

// ---------- 4. Ground footprint: how much of Earth it can see ----------

function diagramFootprint(sat) {
  const alt = sat.lastAlt;
  if (alt == null) return '';

  // Horizon half-angle from the satellite's altitude
  const centralAngleRad = Math.acos(EARTH_R_KM / (EARTH_R_KM + alt));
  const centralDeg = (centralAngleRad * 180) / Math.PI;
  const footprintRadiusKm = EARTH_R_KM * centralAngleRad;
  // Spherical cap area as a share of the whole sphere
  const coveragePct = ((1 - Math.cos(centralAngleRad)) / 2) * 100;

  const W = 300, H = 190;
  const cx = W / 2, cy = H * 0.66, r = 58;
  const satDist = r * (1 + alt / EARTH_R_KM);
  const satY = cy - satDist;
  const edgeAngle = Math.PI / 2 - centralAngleRad;
  const ex = r * Math.cos(edgeAngle), ey = r * Math.sin(edgeAngle);

  return `
    <figure class="dg">
      <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        <circle cx="${cx}" cy="${cy}" r="${r}" class="dg-earth-outline" />
        <path d="M ${cx} ${satY.toFixed(1)} L ${(cx - ex).toFixed(1)} ${(cy - ey).toFixed(1)}
                 A ${r} ${r} 0 0 1 ${(cx + ex).toFixed(1)} ${(cy - ey).toFixed(1)} Z" class="dg-coverage" />
        <line x1="${cx}" y1="${satY.toFixed(1)}" x2="${(cx - ex).toFixed(1)}" y2="${(cy - ey).toFixed(1)}" class="dg-ref-line" />
        <line x1="${cx}" y1="${satY.toFixed(1)}" x2="${(cx + ex).toFixed(1)}" y2="${(cy - ey).toFixed(1)}" class="dg-ref-line" />
        <circle cx="${cx}" cy="${satY.toFixed(1)}" r="3.5" class="dg-sat" />
        <text x="8" y="16" class="dg-label hot">Sees ${coveragePct.toFixed(1)}% of Earth</text>
        <text x="8" y="30" class="dg-label dim">Footprint radius ${Math.round(footprintRadiusKm).toLocaleString()} km</text>
        <text x="8" y="44" class="dg-label dim">Horizon half-angle ${centralDeg.toFixed(1)}°</text>
      </svg>
      <figcaption>The patch of Earth within line of sight right now, computed from current altitude.</figcaption>
    </figure>`;
}

// ---------- 5. Speed comparison ----------

function diagramSpeed(sat, velocityKms) {
  if (velocityKms == null) return '';
  const kmh = velocityKms * 3600;
  const refs = [
    { name: 'Car (motorway)', kmh: 110 },
    { name: 'Airliner', kmh: 900 },
    { name: 'Concorde', kmh: 2180 },
    { name: 'This object', kmh, hot: true },
  ];
  const max = Math.max(...refs.map((r) => r.kmh));
  const W = 300, H = 150;
  const barH = 18, gap = 12;

  const bars = refs.map((r, i) => {
    const y = 26 + i * (barH + gap);
    const w = Math.max((r.kmh / max) * (W - 130), 2);
    return `
      <text x="8" y="${y + 13}" class="dg-label ${r.hot ? 'hot' : 'dim'}">${escapeXml(r.name)}</text>
      <rect x="118" y="${y}" width="${w.toFixed(1)}" height="${barH}" rx="3" class="${r.hot ? 'dg-bar-hot' : 'dg-bar'}" />
      <text x="${(122 + w).toFixed(1)}" y="${y + 13}" class="dg-label ${r.hot ? 'hot' : 'dim'}">${Math.round(r.kmh).toLocaleString()} km/h</text>`;
  }).join('');

  return `
    <figure class="dg">
      <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        <text x="8" y="14" class="dg-label">Orbital speed in context</text>
        ${bars}
      </svg>
      <figcaption>Orbital velocity compared with familiar speeds — this is why orbits stay up rather than falling back.</figcaption>
    </figure>`;
}

// ---------- Assembly ----------

function renderSatelliteDiagrams(sat) {
  const el = document.getElementById('sat-diagrams');
  if (!el || !sat || !sat.satrec) return;

  let velocity = null;
  const pv = safePropagate(sat.satrec, new Date());
  if (pv && pv.velocity) {
    velocity = Math.sqrt(pv.velocity.x ** 2 + pv.velocity.y ** 2 + pv.velocity.z ** 2);
  }

  el.innerHTML = `
    <div class="dg-grid">
      ${diagramOrbitProfile(sat)}
      ${diagramAltitudeLadder(sat)}
      ${diagramInclination(sat)}
      ${diagramFootprint(sat)}
      ${diagramSpeed(sat, velocity)}
    </div>
    <div class="meta">All five diagrams are generated live from this object's own orbital elements — no stock artwork.</div>
  `;
}
