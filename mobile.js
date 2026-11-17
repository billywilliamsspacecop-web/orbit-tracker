// Mobile / small-screen behaviour that CSS alone can't express.
// Loaded after every other app script, before the bootstrap block runs.

(function () {
  const phoneQuery = window.matchMedia('(max-width: 640px)');
  const smallQuery = window.matchMedia('(max-width: 640px), (max-height: 500px) and (pointer: coarse)');

  // Tapping a satellite on the phone map: the details live in the panel
  // below the map, so bring that panel into view.
  if (typeof window.selectSatellite === 'function') {
    const original = window.selectSatellite;
    window.selectSatellite = function (...args) {
      const result = original.apply(this, args);
      if (phoneQuery.matches) {
        const panel = document.getElementById('detail-panel');
        const sidebar = document.getElementById('sidebar');
        if (panel && sidebar) sidebar.scrollTo({ top: panel.offsetTop - 10, behavior: 'smooth' });
      }
      return result;
    };
  }

  // Picking a launch from the lists further down: scroll back up to the dome
  // so the replay that just started is actually visible.
  if (typeof window.beginReplay === 'function') {
    const original = window.beginReplay;
    window.beginReplay = function (...args) {
      const result = original.apply(this, args);
      if (smallQuery.matches) {
        const view = document.getElementById('launches-view');
        if (view) view.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return result;
    };
  }

  // The icon legend covers a big share of a phone-sized map; start it closed.
  window.addEventListener('DOMContentLoaded', () => {
    if (!smallQuery.matches) return;
    const legend = document.getElementById('map-legend');
    const btn = document.getElementById('legend-toggle');
    if (legend && btn && !legend.classList.contains('collapsed')) btn.click();
  });

  // Rotation / layout switches change the map's box; Leaflet needs telling.
  const relayout = () => {
    if (typeof map !== 'undefined' && map && map.invalidateSize) setTimeout(() => map.invalidateSize(), 120);
  };
  window.addEventListener('orientationchange', relayout);
  phoneQuery.addEventListener('change', relayout);
})();
