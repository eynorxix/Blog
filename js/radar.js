import { subscribeVoteTotals } from './nostr.js';

export const UNIVERSES = [
  { id: 'spidey', color: '#ff3344', fg: '#ffffff', shortName: 'Tobey' },
  { id: 'xmen', color: '#3388ff', fg: '#ffffff', shortName: 'X-Men' },
  { id: 'mcu', color: '#ffaa00', fg: '#14161a', shortName: 'MCU' },
  { id: 'f4', color: '#00cc99', fg: '#14161a', shortName: 'F4' },
  { id: 'doom', color: '#a855f7', fg: '#ffffff', shortName: 'Doom' },
  { id: 'tva', color: '#ff5500', fg: '#ffffff', shortName: 'TVA' },
];

const UNITS = [
  { value: 1e12, suffix: 'T' },
  { value: 1e9, suffix: 'B' },
  { value: 1e6, suffix: 'M' },
  { value: 1e3, suffix: 'K' },
];

let chart = null;
let started = false;

function formatVotes(count) {
  if (count <= 99) return `vot: ${count}`;
  if (count <= 9999) return `+${count}`;
  for (const unit of UNITS) {
    if (count >= unit.value) {
      const scaled = count / unit.value;
      const text = scaled >= 100 ? String(Math.floor(scaled)) : scaled.toFixed(1).replace(/\.0$/, '');
      return `+${text}${unit.suffix}`;
    }
  }
  return `+${count}`;
}

function buildLabels(totals) {
  return UNIVERSES.map((u) => [formatVotes(totals[u.id] || 0), u.shortName]);
}

export function initRadar() {
  if (started) return;
  started = true;

  const canvas = document.getElementById('multiverseRadar');
  const card = document.getElementById('radarCard');
  if (!canvas || typeof Chart === 'undefined') {
    if (card) card.classList.add('hidden');
    return;
  }

  const zero = Object.fromEntries(UNIVERSES.map((u) => [u.id, 0]));

  chart = new Chart(canvas.getContext('2d'), {
    type: 'radar',
    data: {
      labels: buildLabels(zero),
      datasets: [
        {
          label: 'Apoyo Multiversal',
          data: UNIVERSES.map((u) => 0),
          backgroundColor: 'rgba(0, 255, 204, 0.22)',
          borderColor: '#00b894',
          borderWidth: 2,
          pointBackgroundColor: UNIVERSES.map((u) => u.color),
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5,
          pointRadius: 5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600 },
      scales: {
        r: {
          angleLines: { color: 'rgba(255,255,255,0.14)' },
          grid: { color: 'rgba(255,255,255,0.14)' },
          pointLabels: {
            color: '#d9c9f5',
            font: { size: 10, weight: '600' },
          },
          ticks: { display: false },
          min: 0,
          beginAtZero: true,
        },
      },
      plugins: { legend: { display: false } },
    },
  });

  let live = false;
  let firstData = true;
  subscribeVoteTotals(
    (totals) => {
      if (!chart) return;
      const values = UNIVERSES.map((u) => totals[u.id] || 0);
      chart.data.labels = buildLabels(totals);
      chart.data.datasets[0].data = values;
      chart.options.scales.r.max = Math.max(...values, 10);
      chart.update();
      if (card && !firstData) {
        card.classList.remove('flash');
        void card.offsetWidth;
        card.classList.add('flash');
      }
      const label = document.getElementById('liveLabel');
      if (label) {
        label.textContent = live
          ? `en vivo · ${new Date().toLocaleTimeString()}`
          : 'en vivo · Nostr';
      }
      firstData = false;
    },
    () => {
      live = true;
    }
  );
}