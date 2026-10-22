/**
 * Chart.js helpers — theme-aware, recreated cleanly on every data change.
 */
import { formatINR, formatCompactINR } from './utils.js';

const registry = new Map();
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export const palette = () => ({
  accent: css('--accent'), expense: css('--expense'), income: css('--income'),
  text: css('--text-2'), grid: css('--grid'), surface: css('--surface'),
  series: ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7', '--c8'].map(css),
});

function base(p) {
  return {
    responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false, labels: { color: p.text, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded', font: { family: 'Manrope', size: 12 } } },
      tooltip: {
        backgroundColor: '#14161B', titleColor: '#fff', bodyColor: '#E4E5E8', borderColor: 'rgba(255,255,255,.08)', borderWidth: 1,
        padding: 10, cornerRadius: 8, titleFont: { family: 'Manrope', weight: '700' }, bodyFont: { family: 'Manrope' },
        callbacks: { label: (c) => ` ${c.dataset.label ? c.dataset.label + ': ' : ''}${formatINR(c.parsed.y ?? c.parsed)}` },
      },
    },
    scales: {
      x: { grid: { display: false }, border: { display: false }, ticks: { color: p.text, font: { family: 'Manrope', size: 11 }, maxRotation: 0, autoSkipPadding: 8 } },
      y: { grid: { color: p.grid }, border: { display: false }, beginAtZero: true, ticks: { color: p.text, font: { family: 'Manrope', size: 11 }, callback: (v) => formatCompactINR(v), maxTicksLimit: 6 } },
    },
  };
}

function render(id, canvas, config) {
  registry.get(id)?.destroy();
  if (!window.Chart || !canvas) return null;
  const chart = new window.Chart(canvas, config);
  registry.set(id, chart);
  return chart;
}

/** Grouped bars: expense vs income per month */
export function barTrend(id, canvas, { labels, expense, income }) {
  const p = palette(); const o = base(p);
  o.plugins.legend.display = true; o.plugins.legend.position = 'bottom';
  return render(id, canvas, {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Expenses', data: expense, backgroundColor: p.expense, borderRadius: 6, maxBarThickness: 26 },
      { label: 'Income', data: income, backgroundColor: p.income, borderRadius: 6, maxBarThickness: 26 },
    ] },
    options: o,
  });
}

/** Daily line with cumulative overlay */
export function lineDaily(id, canvas, { labels, daily, cumulative, budget }) {
  const p = palette(); const o = base(p);
  o.plugins.legend.display = true; o.plugins.legend.position = 'bottom';
  o.scales.y1 = { position: 'right', grid: { display: false }, border: { display: false }, beginAtZero: true, ticks: { color: p.text, font: { family: 'Manrope', size: 11 }, callback: (v) => formatCompactINR(v), maxTicksLimit: 6 } };
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 260);
  grad.addColorStop(0, hexA(p.accent, 0.28)); grad.addColorStop(1, hexA(p.accent, 0));
  const datasets = [
    { type: 'bar', label: 'Spent that day', data: daily, backgroundColor: hexA(p.expense, 0.75), borderRadius: 4, maxBarThickness: 14, yAxisID: 'y', order: 2 },
    { type: 'line', label: 'Running total', data: cumulative, borderColor: p.accent, backgroundColor: grad, fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2, yAxisID: 'y1', order: 1 },
  ];
  if (budget) datasets.push({ type: 'line', label: 'Budget', data: labels.map(() => budget), borderColor: p.text, borderDash: [5, 5], borderWidth: 1.2, pointRadius: 0, yAxisID: 'y1', order: 0 });
  return render(id, canvas, { data: { labels, datasets }, options: o });
}

/** Doughnut by category */
export function doughnut(id, canvas, { labels, values }) {
  const p = palette();
  return render(id, canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: labels.map((_, i) => p.series[i % p.series.length]), borderColor: p.surface, borderWidth: 3, hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%', animation: { duration: 500 },
      plugins: {
        legend: { display: false },
        tooltip: { ...base(p).plugins.tooltip, callbacks: { label: (c) => ` ${c.label}: ${formatINR(c.parsed)}` } },
      },
    },
  });
}

export function destroyAll() { registry.forEach((c) => c.destroy()); registry.clear(); }

function hexA(color, a) {
  const c = color.replace('#', '');
  if (c.length !== 6) return color;
  const n = parseInt(c, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
