// resize.js — draggable splitter, resizable panels, and a full-screen
// expand for the selected-satellite panel.
//
// Sizes persist in localStorage so the layout you set stays put.

const LS_SIDEBAR = 'orbitus.sidebarWidth';
const LS_PANEL_PREFIX = 'orbitus.panelH.';

// ---------- Main map / sidebar splitter ----------

function applySidebarWidth(px) {
  const layout = document.getElementById('tracker-view');
  if (!layout) return;
  const min = 300;
  const max = Math.max(min, window.innerWidth - 360);
  const w = Math.min(max, Math.max(min, px));
  layout.style.gridTemplateColumns = `1fr 6px ${w}px`;
  return w;
}

function initSplitter() {
  const splitter = document.getElementById('splitter');
  const layout = document.getElementById('tracker-view');
  if (!splitter || !layout) return;

  const saved = parseInt(localStorage.getItem(LS_SIDEBAR) || '', 10);
  applySidebarWidth(Number.isFinite(saved) ? saved : 340);

  let dragging = false;

  const onMove = (e) => {
    if (!dragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const rect = layout.getBoundingClientRect();
    const w = applySidebarWidth(rect.right - clientX);
    // Leaflet needs to know its container changed size
    if (typeof map !== 'undefined' && map.invalidateSize) map.invalidateSize();
    if (w) localStorage.setItem(LS_SIDEBAR, String(w));
  };

  const stop = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('is-resizing');
    if (typeof map !== 'undefined' && map.invalidateSize) map.invalidateSize();
  };

  const start = (e) => {
    dragging = true;
    document.body.classList.add('is-resizing');
    e.preventDefault();
  };

  splitter.addEventListener('mousedown', start);
  splitter.addEventListener('touchstart', start, { passive: false });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('mouseup', stop);
  window.addEventListener('touchend', stop);

  // Double-click resets to the default width
  splitter.addEventListener('dblclick', () => {
    applySidebarWidth(340);
    localStorage.setItem(LS_SIDEBAR, '340');
    if (typeof map !== 'undefined' && map.invalidateSize) map.invalidateSize();
  });
}

// ---------- Per-panel vertical resize ----------
// Any .panel.resizable gets a grab handle along its bottom edge.

// Below this, the photo/media block at the top of the selected-satellite
// panel starts getting cut off mid-image by the panel's own scroll clip
// instead of just showing less of the text below it — so the drag handle
// (and any size saved from before this minimum existed) is clamped here.
const PANEL_MIN_HEIGHT = 240;

function initPanelResizers() {
  document.querySelectorAll('.panel.resizable').forEach((panel) => {
    const id = panel.id || Math.random().toString(36).slice(2);
    const saved = parseInt(localStorage.getItem(LS_PANEL_PREFIX + id) || '', 10);
    if (Number.isFinite(saved)) {
      const h = Math.max(PANEL_MIN_HEIGHT, saved);
      panel.style.height = `${h}px`;
      panel.style.overflowY = 'auto';
    }

    if (panel.querySelector('.panel-resize-handle')) return;
    const handle = document.createElement('div');
    handle.className = 'panel-resize-handle';
    handle.title = 'Drag to resize · double-click to reset';
    panel.appendChild(handle);

    let dragging = false;
    let startY = 0;
    let startH = 0;

    const onMove = (e) => {
      if (!dragging) return;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const h = Math.max(PANEL_MIN_HEIGHT, startH + (clientY - startY));
      panel.style.height = `${h}px`;
      panel.style.overflowY = 'auto';
      localStorage.setItem(LS_PANEL_PREFIX + id, String(h));
      e.preventDefault();
    };

    const stop = () => {
      dragging = false;
      document.body.classList.remove('is-resizing');
    };

    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      startY = e.clientY;
      startH = panel.getBoundingClientRect().height;
      document.body.classList.add('is-resizing');
      e.preventDefault();
    });
    handle.addEventListener('touchstart', (e) => {
      dragging = true;
      startY = e.touches[0].clientY;
      startH = panel.getBoundingClientRect().height;
      document.body.classList.add('is-resizing');
      e.preventDefault();
    }, { passive: false });

    handle.addEventListener('dblclick', () => {
      panel.style.height = '';
      panel.style.overflowY = '';
      localStorage.removeItem(LS_PANEL_PREFIX + id);
    });

    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', stop);
    window.addEventListener('touchend', stop);
  });
}

// ---------- Expand the detail panel to full screen ----------

function initPanelExpand() {
  const btn = document.getElementById('detail-expand');
  const panel = document.getElementById('detail-panel');
  if (!btn || !panel) return;

  btn.addEventListener('click', () => {
    const on = panel.classList.toggle('panel-fullscreen');
    document.body.classList.toggle('has-fullscreen-panel', on);
    btn.textContent = on ? '⤡' : '⤢';
    btn.title = on ? 'Collapse' : 'Expand to full screen';
    // Charts/diagrams inside need a beat to pick up the new size
    setTimeout(() => {
      if (typeof state !== 'undefined' && state.selected && typeof renderSatelliteDiagrams === 'function') {
        renderSatelliteDiagrams(state.selected);
      }
    }, 60);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('panel-fullscreen')) btn.click();
  });
}

// ---------- Launch dome resize ----------
// Same drag-to-resize idea as the panels above, but the dome starts out
// aspect-ratio-locked (so it isn't stretched before the user ever touches
// it); dragging switches it to an explicit height instead.

const LS_DOME_HEIGHT = 'orbitus.domeHeight';
const DOME_MIN_HEIGHT = 320;

function initDomeResizer() {
  const dome = document.getElementById('launch-dome');
  const handle = document.getElementById('launch-dome-resize-handle');
  if (!dome || !handle) return;

  const saved = parseInt(localStorage.getItem(LS_DOME_HEIGHT) || '', 10);
  if (Number.isFinite(saved)) {
    dome.style.height = `${Math.max(DOME_MIN_HEIGHT, saved)}px`;
    dome.classList.add('custom-size');
  }

  let dragging = false;
  let startY = 0;
  let startH = 0;

  const onMove = (e) => {
    if (!dragging) return;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const h = Math.max(DOME_MIN_HEIGHT, startH + (clientY - startY));
    dome.style.height = `${h}px`;
    dome.classList.add('custom-size');
    localStorage.setItem(LS_DOME_HEIGHT, String(h));
    e.preventDefault();
  };

  const stop = () => {
    dragging = false;
    document.body.classList.remove('is-resizing');
  };

  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    startY = e.clientY;
    startH = dome.getBoundingClientRect().height;
    document.body.classList.add('is-resizing');
    e.preventDefault();
  });
  handle.addEventListener('touchstart', (e) => {
    dragging = true;
    startY = e.touches[0].clientY;
    startH = dome.getBoundingClientRect().height;
    document.body.classList.add('is-resizing');
    e.preventDefault();
  }, { passive: false });

  handle.addEventListener('dblclick', () => {
    dome.style.height = '';
    dome.classList.remove('custom-size');
    localStorage.removeItem(LS_DOME_HEIGHT);
  });

  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('mouseup', stop);
  window.addEventListener('touchend', stop);
}

function initResizers() {
  initSplitter();
  initPanelResizers();
  initPanelExpand();
  initDomeResizer();
}
