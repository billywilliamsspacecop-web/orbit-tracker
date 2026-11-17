// boot.js — intro sequence, then the view picker, then the app.
//
// The important bit: satellite data loads DURING the animation, so the
// intro isn't dead time. By the time the picker appears, positions are
// already primed and the map can render without the old scatter effect.

const INTRO_MIN_MS = 2600; // let the sunset actually play

const bootState = { dataReady: false, introDone: false, launchCount: null };

function setIntroStatus(text, pct) {
  const s = document.getElementById('intro-status');
  const bar = document.getElementById('intro-progress-bar');
  if (s) s.textContent = text;
  if (bar && pct != null) bar.style.width = `${pct}%`;
}

function finishIntro() {
  if (bootState.introDone) return;
  bootState.introDone = true;

  const intro = document.getElementById('intro');
  intro.classList.add('intro-out');
  setTimeout(() => { intro.hidden = true; }, 700);

  showPicker();
}

function showPicker() {
  const picker = document.getElementById('picker');

  document.getElementById('picker-stat-sats').textContent =
    bootState.dataReady ? `${totalLoadedCount()} objects live` : 'Loading…';
  document.getElementById('picker-stat-launches').textContent =
    bootState.launchCount != null ? `${bootState.launchCount} scheduled` : 'Live feed';

  picker.hidden = false;
  requestAnimationFrame(() => picker.classList.add('picker-in'));
}

function choosePickerView(view) {
  const picker = document.getElementById('picker');
  picker.classList.remove('picker-in');
  setTimeout(() => { picker.hidden = true; }, 260);

  document.getElementById('app').hidden = false;
  switchMode(view || 'launches');

  // The map was built inside a hidden container, so it needs a size nudge.
  setTimeout(() => map.invalidateSize(), 80);
}

async function bootSequence() {
  const startedAt = Date.now();

  document.getElementById('intro-skip').addEventListener('click', finishIntro);
  document.querySelectorAll('.picker-card').forEach((card) => {
    card.addEventListener('click', () => choosePickerView(card.dataset.view));
  });

  // Kick off data loading immediately, behind the animation
  setIntroStatus('Contacting CelesTrak…', 12);

  const dataPromise = (async () => {
    try {
      await init();
      bootState.dataReady = true;
      setIntroStatus(`${totalLoadedCount()} objects acquired`, 88);
    } catch (err) {
      console.error(err);
      setIntroStatus('Some data unavailable — continuing', 88);
    }
  })();

  // Prefetch launches too so the picker can show a real count
  const launchPromise = (async () => {
    try {
      const d = await ensureLaunchesData();
      bootState.launchCount = d.upcoming.length;
    } catch (err) {
      bootState.launchCount = null;
    }
  })();

  // Staged status text while the sunset plays
  setTimeout(() => setIntroStatus('Propagating orbits (SGP4)…', 45), 700);
  setTimeout(() => setIntroStatus('Priming ground positions…', 68), 1500);

  await Promise.race([
    Promise.all([dataPromise, launchPromise]),
    new Promise((r) => setTimeout(r, 9000)), // don't hang forever on a slow network
  ]);

  setIntroStatus('Ready', 100);

  // Always let the animation breathe, even if data was instant
  const elapsed = Date.now() - startedAt;
  setTimeout(finishIntro, Math.max(0, INTRO_MIN_MS - elapsed));
}
