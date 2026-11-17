// geo.js — coastline outlines for the dome/horizon views.
//
// Loads Natural Earth land polygons (110m, the coarse "simple line art"
// resolution) as TopoJSON from a CDN and decodes them to plain rings. If the
// CDN is unreachable the views still work — they just render without
// continents rather than breaking.

let landRings = null;      // array of [ [lon,lat], ... ] rings
let landPromise = null;

// Minimal TopoJSON decoder — we only need `arcs` + Polygon/MultiPolygon,
// which avoids pulling in the whole topojson-client library.
function decodeTopology(topo, objectName) {
  const obj = topo.objects[objectName];
  if (!obj) return [];

  const { scale, translate } = topo.transform || { scale: [1, 1], translate: [0, 0] };

  // Arcs are delta-encoded and quantised
  const arcs = topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => {
      x += dx; y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });

  const resolveArc = (i) => (i < 0 ? arcs[~i].slice().reverse() : arcs[i]);

  const ringFrom = (arcIdxs) => {
    const pts = [];
    for (const idx of arcIdxs) {
      const seg = resolveArc(idx);
      // Adjacent arcs share an endpoint; drop the duplicate
      pts.push(...(pts.length ? seg.slice(1) : seg));
    }
    return pts;
  };

  const rings = [];
  const geometries = obj.type === 'GeometryCollection' ? obj.geometries : [obj];
  for (const g of geometries) {
    if (g.type === 'Polygon') {
      for (const r of g.arcs) rings.push(ringFrom(r));
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.arcs) for (const r of poly) rings.push(ringFrom(r));
    }
  }
  return rings;
}

function loadLandOutlines() {
  if (landPromise) return landPromise;
  landPromise = (async () => {
    try {
      const res = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const topo = await res.json();
      landRings = decodeTopology(topo, 'land')
        // Drop specks (tiny islands) — this is meant to read as simple line art
        .filter((r) => r.length > 12);
      return landRings;
    } catch (err) {
      console.warn('Coastline data unavailable, continuing without it:', err.message);
      landRings = [];
      return landRings;
    }
  })();
  return landPromise;
}

// ---------- Horizon projection ----------
// Maps lon/lat onto a curved horizon band: longitude runs along the arc,
// latitude pushes points "back" (up the band) toward the far limb. It's a
// stylised panorama, not a true map projection — same schematic spirit as
// the rest of the dome views.

function horizonProject(lon, lat, opts) {
  const { centerLon, spanLon, width, horizonYFn, bandDepth } = opts;

  let dLon = lon - centerLon;
  while (dLon > 180) dLon -= 360;
  while (dLon < -180) dLon += 360;

  if (Math.abs(dLon) > spanLon / 2) return null; // off this hemisphere

  const x = width / 2 + (dLon / (spanLon / 2)) * (width / 2);
  const baseY = horizonYFn(x);
  // Higher |lat| sits further "back" (visually up), poles nearest the limb
  const depth = (Math.abs(lat) / 90) * bandDepth;
  const y = baseY + depth * (lat >= 0 ? -1 : 1) * 0.55 + bandDepth * 0.22;
  return [x, y];
}

// Builds SVG <path> data for coastlines projected onto a horizon band.
function coastlinePathData(opts) {
  if (!landRings || !landRings.length) return '';
  const segments = [];

  for (const ring of landRings) {
    let current = [];
    for (const [lon, lat] of ring) {
      const p = horizonProject(lon, lat, opts);
      if (!p) {
        if (current.length > 1) segments.push(current);
        current = [];
        continue;
      }
      current.push(p);
    }
    if (current.length > 1) segments.push(current);
  }

  return segments
    .map((seg) => 'M' + seg.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L'))
    .join(' ');
}
