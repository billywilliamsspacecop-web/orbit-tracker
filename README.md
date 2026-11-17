# ORBITUS 1.5 ALPHA

A self-contained local web app that turns public satellite, launch, weather
and media data into something you can actually explore — live orbital
tracking, mission telemetry, rocket schedules, and a dashboard that ties it
all together.

## Running it

**Online:** https://billywilliamsspacecop-web.github.io/orbit-tracker/ — the
`public/` folder is published to GitHub Pages from the `gh-pages` branch.
After committing to `main`, run `npm run deploy` to update the live site. No
server is needed: `public/static-api.js` answers the app's `/api/*` calls in
the browser by calling CelesTrak, Launch Library 2, NASA Images and
Open-Meteo directly (all allow cross-origin requests), with a localStorage
cache.

**Locally**, zero dependencies, plain Node:

```
node server.js
```

Then open **http://localhost:4173**.

(Different port: `PORT=8080 node server.js`.)

## Mobile & square screens

`public/mobile.css` + `public/mobile.js` adapt the layout:

- **Phones** — bottom tab bar for the three views, map stacked over the
  panels, full-screen drawers/lightbox, bigger touch targets, legend starts
  collapsed, tapping a satellite scrolls its details into view.
- **Phone landscape** — compact chrome, map beside a narrow sidebar.
- **Square (≈1:1) screens** — full-width 2:1 map over a two-column panel
  grid; launches keep the dome beside the rail; small squares drop the
  ticker and shrink the nav to claw back height.

## The flow

1. **Intro** — a ~2.6s sunset animation while satellite and launch data load
   in the background. Skippable. The loading happens *during* the animation,
   so the intro isn't dead time.
2. **View picker** — Launches leads (it's the most fun way in), then
   Satellites and Mission Control.
3. **The app** — switch views any time from the top bar.

## Satellites view

- Live orbital elements (TLEs) for six groups — stations, GPS, weather,
  Starlink, science, geostationary — from [CelesTrak](https://celestrak.org),
  propagated in-browser with `satellite.js` (SGP4), updating every 2s.
- **Directional icons.** Each satellite is a small satellite silhouette
  rotated to point along its direction of travel, sized by object class
  (station → smallsat). The on-map legend explains the scale — it's a
  legible size *ranking*, not true scale, since a real satellite would be
  sub-pixel at world zoom.
- **No more load scramble.** Positions are computed before any marker
  exists, so nothing spawns at 0,0 and scatters.
- **English map labels** by default (Esri dark canvas), with a `🌐` toggle
  to flip back to local-language names.
- **Cloud layer** toggle — real NASA GIBS/MODIS true-colour imagery showing
  actual cloud systems beneath the satellites.
- Named objects (ISS, Tiangong, Hubble, Webb, Dragon, Soyuz, GOES, NOAA,
  Landsat…) get labelled badges above the swarm.
- Click any satellite for live position, altitude, velocity, period, launch
  year and compass heading, plus three sub-tabs:
  - **Telemetry** — inclination, eccentricity, apogee/perigee, mean motion,
    TLE epoch, international designator.
  - **Trajectory** — heading, orbits/day, toggleable ground track.
  - **Media** — Photos / Videos tabs (see below).
- **MAP / DOME / HORIZON** toggle. Dome is the 2.5D layered orbital view
  (zoom, tilt, reset, scroll-wheel). Horizon uses the launch-dome visual
  language — a curved Earth with real coastlines and satellites plotted
  above at their true altitude band — with a West/East hemisphere toggle,
  since a whole globe doesn't fit that shape.
- **Diagrams tab.** Five explanatory diagrams generated live from the
  selected object's own orbital elements: orbit ellipse to scale with Earth
  at its focus, altitude on a log ladder against familiar references,
  inclination coverage band, ground footprint (what share of Earth it can
  see right now), and orbital speed in context. No stock artwork.
- **Resizable layout.** Drag the splitter to widen the sidebar, drag any
  resizable panel's bottom edge, or hit ⤢ to blow the selected-satellite
  panel up to full screen. Sizes persist between sessions.
- Composition donut, altitude histogram, and a blueprint orbital
  cross-section in the sidebar. Every orbit label shows the full name
  alongside the abbreviation.

## Launches view

- Upcoming and recent launches from
  [The Space Devs](https://thespacedevs.com) — vehicle, provider, pad,
  target orbit, status, countdown.
- **2.5D launch dome** — curved horizon with real coastline outlines
  (Natural Earth 110m) beneath it, altitude bands above.
- **Mission replay** — the centrepiece. The feed publishes a real event
  timeline per launch (liftoff, Max-Q, MECO, stage separation, fairing jettison,
  entry burn, landing burn, touchdown, SECO, engine relight, payload
  deployment) with actual T+ times. The replay flies it end to end:
  - The vehicle climbs, reaches orbit at second-stage cutoff, then **coasts
    along the orbital band** so the late events (relight, second cutoff,
    payload deployment an hour in) are all watchable.
  - The booster separates at MECO, arcs over, lights its entry burn, and
    descends to its real named landing zone at the real touchdown time,
    with a splashdown ripple on the drone ship.
  - Payload satellites visibly deploy from the stage at the published
    deployment time.
  - Motion throughout: launch smoke at the pad, exhaust particles, glowing
    trails, a separation flash, flickering engine plumes.
  - **Transport controls** — restart, previous/next event, ±10s, play/pause,
    0.5× to 150× speed, and a scrubber. Space, ← and → work too.
  - **Stage cards** — each event gets a card with its published description
    and a generated diagram of what's happening.
  - Clickable milestone strip that highlights the current event.
- **Local pad time** ticks alongside UTC using the launch site's real IANA
  timezone.
- **Right-hand rail** — mission brief for the selected launch (vehicle
  specs, booster serial and flight number, recovery zone, downrange
  distance) plus compact "Next up" and "Just flown" lists, so the launch
  list isn't buried under the diagram.
- **Details drawer** — full vehicle/mission specs, pad coordinates, live
  pad weather, and searchable mission media.
- When pad coordinates or target orbit aren't published, the trajectory
  button is disabled and says exactly what's missing.

## Mission Control view

Deliberately dense — the goal is "more than you need, two clicks away":

- Live-ticking next-launch countdown with a jump into full mission details.
- Six KPI tiles: objects tracked, LEO/MEO/GEO counts, named objects, groups loaded.
- Pad weather for the next launch.
- Six charts: orbit distribution, objects by group, launch cadence by
  provider, mission types, inclination spread, launch decade, orbital
  period spread.
- Leaderboards for launch sites and providers.
- **Orbit glossary** — full names, altitudes, periods and plain-English
  explanations for LEO, MEO, GEO, GSO, HEO, SSO, GTO and polar orbits.
- **Object catalogue** — searchable and sortable table of every tracked
  object (altitude, inclination, period, launch year). Click a row to jump
  to it on the map with it selected.
- Clickable upcoming schedule table and a recent activity feed.
- Highest / lowest / fastest readout of what's overhead right now.

## Media: photos and video

Both satellites and rockets pull from NASA's Image and Video Library —
public domain, always credited, always linked back to the original record.

- **Photos** — hero image, thumbnail strip, fullscreen lightbox with
  description and credit.
- **Videos** — real mission footage. NASA serves video in two hops (a
  manifest, then the actual files), and the server resolves those, picks a
  sensible mid-size rendition rather than the multi-hundred-MB original,
  and upgrades the http:// asset URLs it returns to https:// so browsers
  don't block them.
- **Webcast fallback** — when NASA has nothing public-domain for a mission
  (common for commercial launches), the app surfaces the provider's own
  official webcast link with a thumbnail preview, clearly labelled as an
  external link on their platform.
- Lightbox supports arrow-key / on-screen prev-next navigation.
- When nothing is found, satellites fall back to a generic technical
  schematic — most catalogued objects (a specific Starlink unit, a specific
  GPS satellite) have no individual public imagery, so this is expected.

## Honesty notes

The project deliberately doesn't invent data:

- **Launch replay** pins to real data at every waypoint: event names and
  their T+ times, the landing zone, downrange distance, pad coordinates and
  target orbit all come from the published feed. What's illustrative is the
  *shape of the curve drawn between* those waypoints — continuous ascent
  telemetry isn't public for any launch, past or future. The UI says so.
- **Weather "Favourable / Marginal / Unfavourable"** is our own rough
  heuristic from wind, cloud and rain. It is *not* an official launch-commit
  criteria evaluation, and it reports "No data" rather than "Favourable"
  when the inputs are missing.
- **The orbital cross-section and dome** are schematic diagrams — real
  altitudes, but spacing and angle chosen for readability.

## Why there's a server

Browsers enforce CORS, and hammering free public APIs on every page load
isn't polite. `server.js` proxies and caches everything:

| Endpoint | Source | Cache |
|---|---|---|
| `/api/gp` | CelesTrak TLEs | 5 min |
| `/api/launches` | Launch Library 2 (list) | 15 min |
| `/api/launch` | Launch Library 2 (full detail) | 15 min |
| `/api/media` | NASA Images & Video | 24 h |
| `/api/satimage` | NASA Images (legacy) | 24 h |
| `/api/weather` | Open-Meteo | 10 min |

The list endpoint stays lightweight; the full `mode=detailed` payload
(which is enormous) is only fetched one launch at a time, on demand, and
slimmed hard server-side.

## File map

- `server.js` — static server + all six data proxies.
- `public/boot.js` — intro animation, background loading, view picker.
- `public/geo.js` — TopoJSON decoder + coastline projection for horizons.
- `public/app.js` — state, map, basemaps, icons, propagation, charts, ticker.
- `public/diagrams.js` — the five generated satellite diagrams.
- `public/blueprint.js` — known objects, media gallery + lightbox, generic
  schematic, orbital cross-section, dome and horizon views.
- `public/weather.js` — Open-Meteo client, weather cards, scrub heuristic.
- `public/replay.js` — mission replay engine driven by the published timeline.
- `public/launches.js` — mode switching, launch list, launch dome, rail, drawer.
- `public/mission.js` — Mission Control dashboard.
- `public/resize.js` — splitter, panel resizing, full-screen expand.

## Extending this

- **Add a satellite group:** add to `GROUPS` in `public/app.js` (id must
  match a group at https://celestrak.org/NORAD/elements/) and to
  `ALLOWED_GROUPS` in `server.js`.
- **Add a known-object icon:** add to `KNOWN_OBJECTS` in `public/blueprint.js`.
- **Tune icon sizing:** `SIZE_CLASSES` / `sizeClassFor()` in `public/app.js`.
- **Add a curated media search:** `CURATED_IMAGE_QUERIES` in `public/blueprint.js`.

## Data credit

[CelesTrak](https://celestrak.org) ·
[satellite.js](https://github.com/shashwatak/satellite-js) (SGP4) ·
[The Space Devs](https://thespacedevs.com) ·
[NASA Image and Video Library](https://images.nasa.gov) (public domain) ·
[NASA EOSDIS GIBS](https://www.earthdata.nasa.gov/engage/open-data-services-and-software/api/gibs) ·
[Open-Meteo](https://open-meteo.com) (CC BY 4.0) ·
Esri / HERE / Garmin / CARTO / OpenStreetMap contributors (map tiles).
