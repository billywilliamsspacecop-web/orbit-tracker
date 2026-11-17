// replay.js — mission replay on the launch dome.
//
// Driven by REAL data: The Space Devs publishes a per-launch event timeline
// (liftoff, Max-Q, MECO, stage separation, entry burn, landing burn,
// touchdown, SECO, deployment) with actual relative times, plus real booster
// landing info (named zone, ASDS/RTLS type, downrange distance).
//
// Real: the event names, their T+ times, the landing zone, the downrange
// distance, the target orbit, the pad coordinates.
// Illustrative: the *shape* of the arcs drawn between those waypoints.
// Nobody publishes continuous ascent telemetry.

const replay = {
  launch: null,
  profile: null,
  playing: false,
  t: 0,
  tMin: -60,
  tMax: 600,
  speed: 8,
  raf: null,
  lastFrame: 0,
};

const EVENT_ROLES = {
  'Liftoff': 'liftoff',
  'Max-Q': 'maxq',
  'MECO': 'meco',
  'Stage 2 Separation': 'sep',
  'Fairing Separation': 'fairing',
  'Entry Burn Startup': 'entryStart',
  'Entry Burn Shutdown': 'entryEnd',
  'Stage 1 Landing Burn': 'landingBurn',
  'Stage 1 Landing': 'touchdown',
  'SECO-1': 'seco',
  'SES-1': 'ses1',
  'SES-2': 'ses2',
  'SECO-2': 'seco2',
  'Starlink Deployment': 'deploy',
  'Payload Deployment': 'deploy',
  'Satellite Deployment': 'deploy',
};

function replayEvents(launch) {
  return (launch.timeline || []).map((e) => ({ ...e, role: EVENT_ROLES[e.abbrev] || null }));
}

function eventAt(launch, role) {
  const e = replayEvents(launch).find((x) => x.role === role);
  return e ? e.seconds : null;
}

function fmtT(sec) {
  const neg = sec < 0;
  const a = Math.abs(Math.round(sec));
  const h = Math.floor(a / 3600);
  const m = Math.floor((a % 3600) / 60);
  const s = a % 60;
  const core = h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
                 : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${neg ? 'T−' : 'T+'}${core}`;
}

// ---------- Flight profile ----------

function buildProfile(launch, geom) {
  const liftoff = eventAt(launch, 'liftoff') ?? 0;
  const meco = eventAt(launch, 'meco') ?? 145;
  const seco = eventAt(launch, 'seco') ?? meco + 380;
  const deploy = eventAt(launch, 'deploy');
  const seco2 = eventAt(launch, 'seco2');
  const ses2 = eventAt(launch, 'ses2');
  const touchdown = eventAt(launch, 'touchdown');
  const fairing = eventAt(launch, 'fairing');
  const sep = eventAt(launch, 'sep');

  const evs = replayEvents(launch);
  const lastEvent = evs.length ? evs[evs.length - 1].seconds : seco;

  return {
    liftoff, meco, seco, seco2, ses2, deploy, touchdown, fairing, sep,
    // The powered climb ends at second-stage cutoff — that's orbit. Anything
    // after is coasting, which we show as travel along the orbital band.
    ascentEnd: seco,
    coastEnd: Math.max(lastEvent, seco + 60),
    hasLanding: touchdown != null && launch.landing && launch.landing.attempt,
    geom,
  };
}

// Same quadratic Bézier the dotted reference path is drawn with (see
// buildAscentPath/quadPoint in launches.js) — the rocket needs to actually
// fly that curve, not just share its start/end points, or it visibly cuts
// across the dotted line instead of riding it.
function bezierAt(t, p0, p1, p2) {
  return (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t ** 2 * p2;
}

// Vehicle: powered climb to orbit, then coasts along the band. Never
// disappears — the interesting orbital events happen during the coast.
function vehicleAt(profile, t) {
  const g = profile.geom;
  if (t < profile.liftoff) return { x: g.padX, y: g.padY, angle: 0, phase: 'pad' };

  if (t <= profile.ascentEnd) {
    const span = Math.max(profile.ascentEnd - profile.liftoff, 1);
    const u = Math.min(1, (t - profile.liftoff) / span);
    // Eases how far *along* the curve we are (slow off the pad, fast by
    // orbit) — the curve's shape itself comes from bezierAt, same as the
    // dotted line, so pacing and path never disagree.
    const eased = 1 - Math.pow(1 - u, 2.1);
    const x = bezierAt(eased, g.padX, g.ctrlX, g.orbitX);
    const y = bezierAt(eased, g.padY, g.ctrlY, g.orbitY);

    const easedN = 1 - Math.pow(1 - Math.min(1, u + 0.02), 2.1);
    const xN = bezierAt(easedN, g.padX, g.ctrlX, g.orbitX);
    const yN = bezierAt(easedN, g.padY, g.ctrlY, g.orbitY);
    const angle = (Math.atan2(yN - y, xN - x) * 180) / Math.PI + 90;
    return { x, y, angle, phase: 'ascent' };
  }

  // Coast: level flight along the orbital band toward the far edge
  const span = Math.max(profile.coastEnd - profile.ascentEnd, 1);
  const u = Math.min(1, (t - profile.ascentEnd) / span);
  const x = g.orbitX + (g.coastX - g.orbitX) * u;
  return { x, y: g.orbitY, angle: 90, phase: 'coast' };
}

function smoothstep(t) {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

function boosterAt(profile, t) {
  if (!profile.hasLanding) return { visible: false };
  const g = profile.geom;
  if (t < profile.meco) return { ...vehicleAt(profile, t), visible: true, attached: true };
  if (t > profile.touchdown) return { x: g.landX, y: g.padYAt(g.landX), angle: 0, visible: true, landed: true };

  const u = (t - profile.meco) / Math.max(profile.touchdown - profile.meco, 1);
  const start = vehicleAt(profile, profile.meco);
  const endX = g.landX;
  const endY = g.padYAt(g.landX);
  const apex = Math.min(start.y, endY) - 42;

  const x = start.x + (endX - start.x) * u;
  const y = (1 - u) * (1 - u) * start.y + 2 * (1 - u) * u * apex + u * u * endY;
  const uN = Math.min(1, u + 0.02);
  const yN = (1 - uN) * (1 - uN) * start.y + 2 * (1 - uN) * uN * apex + uN * uN * endY;
  const tangentAngle = (Math.atan2(yN - y, (endX - start.x) * (uN - u)) * 180) / Math.PI + 90;

  // The booster coasts nose-first right after separation (still carrying
  // its ascent momentum), then flips tail-first partway through the arc so
  // its engines face the direction of travel for the boostback, entry and
  // landing burns — same as the real thing, and it lines back up with the
  // upright `angle: 0` landed pose above instead of just teleporting to it.
  const FLIP_START = 0.10;
  const FLIP_END = 0.26;
  const flip = smoothstep((u - FLIP_START) / (FLIP_END - FLIP_START));
  const angle = tangentAngle + 180 * flip;
  const flipping = u > FLIP_START && u < FLIP_END;

  return { x, y, angle, visible: true, descending: true, flipping, flip };
}

// ---------- Art ----------

// A recognisable rocket rather than a bare triangle: nose cone, body,
// fins. Drawn nose-up so a rotation points it along its track.
function rocketSVG(cls) {
  return `
    <g class="${cls}">
      <path d="M0,-13 C3.4,-8 4.6,-2 4.6,4 L4.6,8 L-4.6,8 L-4.6,4 C-4.6,-2 -3.4,-8 0,-13 Z" class="rk-body"/>
      <path d="M4.6,2 L9,10 L4.6,8 Z" class="rk-fin"/>
      <path d="M-4.6,2 L-9,10 L-4.6,8 Z" class="rk-fin"/>
      <circle cx="0" cy="-4" r="1.7" class="rk-port"/>
    </g>`;
}

function boosterSVG(cls) {
  return `
    <g class="${cls}">
      <rect x="-3" y="-11" width="6" height="20" rx="1.2" class="rk-body"/>
      <path d="M3,5 L6.5,11 L3,9 Z" class="rk-fin"/>
      <path d="M-3,5 L-6.5,11 L-3,9 Z" class="rk-fin"/>
    </g>`;
}

// Expanding smoke at the pad in the first seconds after liftoff
function launchSmoke(profile, t) {
  const g = profile.geom;
  const dt = t - profile.liftoff;
  if (dt < 0 || dt > 26) return '';
  const puffs = [];
  for (let i = 0; i < 6; i++) {
    const age = dt - i * 1.6;
    if (age < 0) continue;
    const grow = Math.min(age / 12, 1);
    const r = 5 + grow * 26;
    const op = Math.max(0, 0.5 * (1 - grow));
    const spread = (i % 2 === 0 ? 1 : -1) * grow * (16 + i * 5);
    puffs.push(`<circle cx="${(g.padX + spread).toFixed(1)}" cy="${(g.padY + 3 - grow * 5).toFixed(1)}" r="${r.toFixed(1)}" class="rp-smoke" opacity="${op.toFixed(2)}"/>`);
  }
  return puffs.join('');
}

// Exhaust particles trailing whatever is currently under power
function exhaust(x, y, angle, t, active, cls) {
  if (!active) return '';
  const bits = [];
  const rad = ((angle - 90) * Math.PI) / 180;
  for (let i = 1; i <= 5; i++) {
    const d = i * 6 + ((t * 12) % 6);
    const px = x - Math.cos(rad) * d;
    const py = y - Math.sin(rad) * d;
    bits.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${(3.2 - i * 0.5).toFixed(1)}" class="${cls}" opacity="${(0.65 - i * 0.11).toFixed(2)}"/>`);
  }
  return bits.join('');
}

function replayOverlaySVG(profile, t) {
  const g = profile.geom;
  const L = replay.launch;
  const v = vehicleAt(profile, t);
  const b = boosterAt(profile, t);

  // Trails
  const trail = [];
  const step = Math.max((t - profile.liftoff) / 90, 0.8);
  for (let s = profile.liftoff; s <= t; s += step) {
    const p = vehicleAt(profile, s);
    trail.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
  }

  const bTrail = [];
  if (profile.hasLanding && t > profile.meco) {
    const upper = Math.min(t, profile.touchdown);
    for (let s = profile.meco; s <= upper; s += Math.max((upper - profile.meco) / 60, 0.8)) {
      const p = boosterAt(profile, s);
      if (p.visible) bTrail.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    }
  }

  const entryStart = eventAt(L, 'entryStart');
  const entryEnd = eventAt(L, 'entryEnd');
  const landingBurn = eventAt(L, 'landingBurn');
  const burning =
    (entryStart != null && t >= entryStart && t <= (entryEnd ?? entryStart + 25)) ||
    (landingBurn != null && t >= landingBurn && t <= (profile.touchdown ?? landingBurn + 25));

  const landed = profile.hasLanding && t >= profile.touchdown;
  const isSea = L.landing && L.landing.typeAbbrev === 'ASDS';

  // Upper stage is under power during ascent, and again for any relight
  const ses2 = profile.ses2, seco2 = profile.seco2;
  const stageBurning = t <= profile.ascentEnd ||
    (ses2 != null && t >= ses2 && t <= (seco2 ?? ses2 + 20));

  // Payload deployment: little satellites drifting away from the stage
  let payload = '';
  if (profile.deploy != null && t >= profile.deploy) {
    const age = t - profile.deploy;
    for (let i = 0; i < 8; i++) {
      const spread = Math.min(age / 8, 1) * (10 + i * 5);
      const dir = i % 2 === 0 ? 1 : -1;
      const px = v.x - spread * 0.7;
      const py = v.y + dir * spread * 0.35;
      payload += `<rect x="${(px - 1.6).toFixed(1)}" y="${(py - 1.6).toFixed(1)}" width="3.2" height="3.2" class="rp-payload" opacity="${Math.max(0.25, 1 - age / 60).toFixed(2)}"/>`;
    }
  }

  // Separation flash
  let sepFlash = '';
  const sepT = profile.sep ?? profile.meco;
  if (sepT != null && t >= sepT && t < sepT + 3) {
    const p = vehicleAt(profile, sepT);
    const k = 1 - (t - sepT) / 3;
    sepFlash = `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(6 + (1 - k) * 22).toFixed(1)}" class="rp-flash" opacity="${(k * 0.8).toFixed(2)}"/>`;
  }

  return `
    ${launchSmoke(profile, t)}
    ${trail.length > 1 ? `<polyline points="${trail.join(' ')}" class="rp-trail"/>` : ''}
    ${bTrail.length > 1 ? `<polyline points="${bTrail.join(' ')}" class="rp-btrail"/>` : ''}
    ${sepFlash}

    ${profile.hasLanding ? `
      <g class="rp-zone">
        <line x1="${g.landX.toFixed(1)}" y1="${(g.padYAt(g.landX) - 11).toFixed(1)}"
              x2="${g.landX.toFixed(1)}" y2="${(g.padYAt(g.landX) + 7).toFixed(1)}"/>
        <text x="${g.landX.toFixed(1)}" y="${(g.padYAt(g.landX) + 19).toFixed(1)}" text-anchor="middle" class="rp-zone-label">
          ${escapeXml(L.landing.zoneAbbrev || L.landing.zoneName || 'Landing zone')}
        </text>
      </g>` : ''}

    ${exhaust(v.x, v.y, v.angle, t, stageBurning, 'rp-ex-main')}
    <g transform="translate(${v.x.toFixed(1)},${v.y.toFixed(1)}) rotate(${v.angle.toFixed(1)})">
      ${rocketSVG('rp-vehicle' + (stageBurning ? ' rp-lit' : ''))}
      ${stageBurning ? '<path d="M-3,9 L0,20 L3,9 Z" class="rp-flame"/>' : ''}
    </g>
    ${payload}

    ${b.visible && !b.attached && !landed ? `
      ${exhaust(b.x, b.y, b.angle || 0, t, burning, 'rp-ex-boost')}
      ${b.flipping ? `<circle cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="13" class="rp-flip-cue" opacity="${(Math.sin(b.flip * Math.PI) * 0.6).toFixed(2)}"/>` : ''}
      <g transform="translate(${b.x.toFixed(1)},${b.y.toFixed(1)}) rotate(${(b.angle || 0).toFixed(1)})">
        ${boosterSVG('rp-booster' + (burning ? ' rp-burning' : ''))}
        ${burning ? '<path d="M-2.6,9 L0,19 L2.6,9 Z" class="rp-flame-boost"/>' : ''}
      </g>` : ''}

    ${landed ? `
      <g class="rp-splash" transform="translate(${g.landX.toFixed(1)},${g.padYAt(g.landX).toFixed(1)})">
        <circle r="6" class="rp-splash-ring"/>
        <circle r="12" class="rp-splash-ring rp-splash-ring2"/>
        ${boosterSVG('rp-booster rp-landed')}
        <text y="-22" text-anchor="middle" class="rp-splash-text">${isSea ? 'DOWN ON DRONE SHIP' : 'TOUCHDOWN'}</text>
      </g>` : ''}
  `;
}

// ---------- Stage info card ----------

// Small generated diagrams per event so each stage has something visual,
// without needing a network round trip mid-playback.
function eventArt(role) {
  const wrap = (inner) => `<svg viewBox="0 0 80 60" xmlns="http://www.w3.org/2000/svg" class="rp-art">${inner}</svg>`;
  switch (role) {
    case 'liftoff':
      return wrap(`<circle cx="40" cy="46" r="12" class="a-smoke"/><circle cx="28" cy="48" r="8" class="a-smoke"/><circle cx="52" cy="48" r="8" class="a-smoke"/>
        <path d="M40,10 C43,16 44,24 44,30 L44,34 L36,34 L36,30 C36,24 37,16 40,10 Z" class="a-body"/><path d="M36,38 L40,50 L44,38 Z" class="a-flame"/>`);
    case 'maxq':
      return wrap(`<path d="M40,12 C43,18 44,26 44,32 L36,32 C36,26 37,18 40,12 Z" class="a-body"/>
        <path d="M18,20 Q40,28 62,20" class="a-wave"/><path d="M18,30 Q40,38 62,30" class="a-wave"/><path d="M18,40 Q40,48 62,40" class="a-wave"/>`);
    case 'meco': case 'sep':
      return wrap(`<path d="M40,8 C43,13 44,19 44,24 L36,24 C36,19 37,13 40,8 Z" class="a-body"/>
        <rect x="36" y="34" width="8" height="18" rx="1" class="a-body2"/>
        <path d="M30,29 L50,29" class="a-dash"/>`);
    case 'fairing':
      return wrap(`<path d="M40,10 C44,18 46,26 46,32 L34,32 C34,26 36,18 40,10 Z" class="a-body"/>
        <path d="M30,36 L22,50" class="a-dash"/><path d="M50,36 L58,50" class="a-dash"/>
        <circle cx="40" cy="42" r="5" class="a-port"/>`);
    case 'entryStart': case 'entryEnd':
      return wrap(`<rect x="36" y="12" width="8" height="22" rx="1" class="a-body2"/>
        <path d="M34,36 Q40,52 46,36 Z" class="a-flame"/>
        <path d="M24,44 Q40,58 56,44" class="a-wave"/>`);
    case 'landingBurn': case 'touchdown':
      return wrap(`<rect x="36" y="8" width="8" height="24" rx="1" class="a-body2"/>
        <path d="M35,34 Q40,46 45,34 Z" class="a-flame"/>
        <rect x="18" y="48" width="44" height="5" rx="1" class="a-pad"/>`);
    case 'seco': case 'seco2': case 'ses1': case 'ses2':
      return wrap(`<ellipse cx="40" cy="34" rx="30" ry="13" class="a-orbit"/>
        <circle cx="40" cy="34" r="9" class="a-earth"/><rect x="66" y="31" width="7" height="6" rx="1" class="a-body2"/>`);
    case 'deploy':
      return wrap(`<rect x="34" y="28" width="12" height="8" rx="1" class="a-body2"/>
        ${[0, 1, 2, 3].map((i) => `<rect x="${16 + i * 14}" y="${14 + (i % 2) * 30}" width="6" height="6" class="a-port"/>`).join('')}`);
    default:
      return wrap(`<circle cx="40" cy="30" r="14" class="a-orbit"/><circle cx="40" cy="30" r="4" class="a-port"/>`);
  }
}

function renderStageCard(launch, t) {
  const el = document.getElementById('stage-card');
  if (!el) return;

  const evs = replayEvents(launch);
  const past = evs.filter((e) => e.seconds <= t);
  const idx = past.length - 1;
  const ev = idx >= 0 ? past[idx] : null;
  const next = evs.find((e) => e.seconds > t);

  if (!ev) {
    el.innerHTML = `
      <div class="sc-art">${eventArt(null)}</div>
      <div class="sc-body">
        <div class="sc-name">Countdown</div>
        <div class="sc-desc">Pre-launch operations. Propellant load, final checks and the go/no-go poll happen here.</div>
        ${next ? `<div class="sc-next">Next: ${escapeXml(next.abbrev)} at ${fmtT(next.seconds)}</div>` : ''}
      </div>`;
    return;
  }

  el.innerHTML = `
    <div class="sc-art">${eventArt(ev.role)}</div>
    <div class="sc-body">
      <div class="sc-name">${escapeXml(ev.abbrev || '')}<span class="sc-t">${fmtT(ev.seconds)}</span></div>
      <div class="sc-desc">${escapeXml(ev.description || 'No published description for this event.')}</div>
      <div class="sc-progress">Event ${idx + 1} of ${evs.length}${next ? ` · next ${escapeXml(next.abbrev)} at ${fmtT(next.seconds)}` : ' · final event'}</div>
    </div>`;
}

// ---------- Frame ----------

function renderReplayFrame() {
  const layer = document.getElementById('replay-layer');
  if (!layer || !replay.launch || !replay.profile) return;

  layer.innerHTML = replayOverlaySVG(replay.profile, replay.t);

  const clock = document.getElementById('replay-clock');
  if (clock) clock.textContent = fmtT(replay.t);

  const slider = document.getElementById('replay-scrub');
  if (slider && document.activeElement !== slider) slider.value = String(replay.t);

  const localEl = document.getElementById('replay-local');
  if (localEl && replay.launch.net) {
    const at = new Date(new Date(replay.launch.net).getTime() + replay.t * 1000);
    localEl.textContent = formatInZone(at, replay.launch.timezone);
  }

  renderStageCard(replay.launch, replay.t);
  highlightTimelineEvent();
}

function highlightTimelineEvent() {
  const evs = replayEvents(replay.launch);
  let activeIdx = -1;
  evs.forEach((e, i) => { if (e.seconds <= replay.t) activeIdx = i; });
  document.querySelectorAll('.rp-ev').forEach((btn, i) => {
    btn.classList.toggle('is-active', i === activeIdx);
    btn.classList.toggle('is-past', i < activeIdx);
  });
}

function replayTick(now) {
  if (!replay.playing) return;
  const dt = (now - replay.lastFrame) / 1000;
  replay.lastFrame = now;
  replay.t += dt * replay.speed;

  if (replay.t >= replay.tMax) {
    replay.t = replay.tMax;
    replay.playing = false;
    updateReplayButton();
  }
  renderReplayFrame();
  if (replay.playing) replay.raf = requestAnimationFrame(replayTick);
}

function updateReplayButton() {
  const btn = document.getElementById('replay-play');
  if (btn) btn.textContent = replay.playing ? '⏸' : '▶';
}

function startReplay() {
  replay.playing = true;
  replay.lastFrame = performance.now();
  updateReplayButton();
  replay.raf = requestAnimationFrame(replayTick);
}

function pauseReplay() {
  replay.playing = false;
  if (replay.raf) cancelAnimationFrame(replay.raf);
  updateReplayButton();
}

function toggleReplay() {
  if (replay.playing) pauseReplay();
  else {
    if (replay.t >= replay.tMax) replay.t = replay.tMin;
    startReplay();
  }
}

function seekReplay(sec) {
  replay.t = Math.min(replay.tMax, Math.max(replay.tMin, sec));
  renderReplayFrame();
}

function stepEvent(dir) {
  if (!replay.launch) return;
  const evs = replayEvents(replay.launch);
  if (!evs.length) return;
  pauseReplay();
  if (dir > 0) {
    const next = evs.find((e) => e.seconds > replay.t + 0.5);
    seekReplay(next ? next.seconds : replay.tMax);
  } else {
    const prev = [...evs].reverse().find((e) => e.seconds < replay.t - 0.5);
    seekReplay(prev ? prev.seconds : replay.tMin);
  }
}

function restartReplay() {
  replay.t = replay.tMin;
  renderReplayFrame();
  if (!replay.playing) startReplay();
}

function beginReplay(launchDetail, geom) {
  pauseReplay();
  replay.launch = launchDetail;
  replay.profile = buildProfile(launchDetail, geom);

  const evs = replayEvents(launchDetail);
  replay.tMin = evs.length ? Math.min(-30, evs[0].seconds) : -30;
  const lastEvent = evs.length ? evs[evs.length - 1].seconds : 600;
  replay.tMax = Math.max(lastEvent + 45, replay.profile.touchdown ? replay.profile.touchdown + 45 : 0, 300);
  replay.t = replay.tMin;

  const slider = document.getElementById('replay-scrub');
  if (slider) {
    slider.min = String(replay.tMin);
    slider.max = String(replay.tMax);
    slider.value = String(replay.t);
  }

  renderReplayTimeline(launchDetail);
  renderReplayFrame();
  startReplay();
}

function renderReplayTimeline(launch) {
  const el = document.getElementById('replay-timeline');
  if (!el) return;
  const evs = replayEvents(launch);
  if (!evs.length) {
    el.innerHTML = '<div class="detail-empty">No published mission timeline for this launch.</div>';
    return;
  }

  el.innerHTML = evs.map((e) => `
    <button class="rp-ev" data-sec="${e.seconds}" title="${escapeXml(e.description || '')}">
      <span class="rp-ev-t">${fmtT(e.seconds)}</span>
      <span class="rp-ev-n">${escapeXml(e.abbrev || '')}</span>
    </button>`).join('');

  el.querySelectorAll('.rp-ev').forEach((btn) => {
    btn.addEventListener('click', () => {
      pauseReplay();
      seekReplay(parseFloat(btn.dataset.sec));
    });
  });
}

function initReplayControls() {
  const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  };

  bind('replay-play', toggleReplay);
  bind('replay-restart', restartReplay);
  bind('replay-prev', () => stepEvent(-1));
  bind('replay-next', () => stepEvent(1));
  bind('replay-back10', () => { pauseReplay(); seekReplay(replay.t - 10); });
  bind('replay-fwd10', () => { pauseReplay(); seekReplay(replay.t + 10); });

  const scrub = document.getElementById('replay-scrub');
  if (scrub) {
    scrub.addEventListener('input', () => { pauseReplay(); seekReplay(parseFloat(scrub.value)); });
  }

  const speed = document.getElementById('replay-speed');
  if (speed) speed.addEventListener('change', () => { replay.speed = parseFloat(speed.value); });

  // Keyboard: space to play/pause, arrows to step events (unless typing)
  document.addEventListener('keydown', (e) => {
    if (!replay.launch) return;
    if (document.getElementById('launches-view').hidden) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;

    if (e.code === 'Space') { e.preventDefault(); toggleReplay(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); stepEvent(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepEvent(-1); }
  });
}
