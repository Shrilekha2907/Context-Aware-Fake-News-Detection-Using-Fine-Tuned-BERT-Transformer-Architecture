const $ = (id) => document.getElementById(id);
const percent = (value, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const signed = (value) => `${value > 0 ? '+' : '-'}${Math.abs(value).toFixed(2)}`;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function showError(id, message) {
  $(id).textContent = message;
  $(id).hidden = !message;
}
function setStatus(ok) {
  $('status').className = `status ${ok ? 'ok' : 'down'}`;
  $('status').querySelector('span').textContent = ok ? 'Model ready' : 'Server offline';
}
async function api(path, body, method) {
  const options = { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json' } };
  if (body) options.body = JSON.stringify(body);
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    setStatus(false);
    throw new Error('The server is not responding. Check that the app is still running, then try again.');
  }
  setStatus(true);
  if (response.status === 422) throw new Error('Check your input: each headline must be 1 to 2,000 characters.');
  if (!response.ok) throw new Error(`The server could not complete this request (error ${response.status}).`);
  return response.json();
}
function tag(label) {
  if (!label) return el('span', 'tag', 'No result');
  return el('span', `tag ${label}`, label === 'fake' ? 'Likely fake' : 'Likely real');
}

/* ---------- Score panel ---------- */
let shownNumber = null;
function animateNumber(target) {
  const node = $('big-number');
  if (target === null) { shownNumber = null; node.textContent = '--'; return; }
  const start = shownNumber ?? target;
  shownNumber = target;
  if (reducedMotion || start === target) { node.textContent = percent(target); return; }
  const began = performance.now();
  const step = (now) => {
    if (shownNumber !== target) return;
    const t = Math.min((now - began) / 280, 1);
    node.textContent = percent(start + (target - start) * t * (2 - t));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function renderScore(result, kind) {
  $('score-kind').textContent = kind;
  const label = result ? result.label : null;
  $('verdict').className = `verdict ${label || ''}`;
  $('verdict').textContent = label ? (label === 'fake' ? 'LIKELY FAKE' : 'LIKELY REAL') : (result ? 'NO RESULT' : 'NO SCORE YET');
  $('track').className = `track ${label || ''}`;
  $('fill').style.width = label ? percent(result.prob_fake, 2) : '0';
  animateNumber(label ? result.prob_fake : null);
  $('giveaway').hidden = !(label && result.has_giveaway_words);
  $('truncated').hidden = !(label && result.truncated);
}

/* ---------- Live check ---------- */
const state = { requestId: 0, timer: null, sample: null, explained: null, removed: new Set() };

function resetWords() {
  state.explained = null;
  state.removed.clear();
  $('words-block').hidden = true;
  $('shift').hidden = true;
  $('restore-btn').hidden = true;
}
function updateTruth(result) {
  const text = $('headline').value.trim();
  const isSample = state.sample && state.sample.headline === text && state.removed.size === 0 && result.label;
  $('truth').hidden = !isSample;
  if (isSample) {
    const right = state.sample.label === result.label;
    $('truth').textContent = `Dataset label: ${state.sample.label === 'fake' ? 'Fake' : 'Real'}. The model got this one ${right ? 'right' : 'wrong'}.`;
  }
}
async function liveScore() {
  const text = $('headline').value.trim();
  const id = ++state.requestId;
  showError('check-error', '');
  if (!text) { renderScore(null, 'Waiting for a headline'); $('truth').hidden = true; return; }
  $('score-kind').textContent = 'Scoring';
  try {
    const result = await api('/api/score', { headline: text });
    if (id !== state.requestId) return;
    renderScore(result, result.label ? 'Live score' : 'BERT needs English text');
    updateTruth(result);
  } catch (error) {
    if (id === state.requestId) showError('check-error', error.message);
  }
}
function wordBackground(effect, largest) {
  const strength = Math.round(Math.min(Math.abs(effect) / largest, 1) * 42) + 6;
  return `color-mix(in srgb, var(--${effect > 0 ? 'fake' : 'real'}) ${strength}%, transparent)`;
}
function renderWords(result) {
  const effects = result.words.map((w) => Math.abs(w.effect || 0));
  const largest = Math.max(...effects, 0.001);
  $('words').replaceChildren(...result.words.map((w, index) => {
    const button = el('button', 'word');
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.append(document.createTextNode(w.word));
    if (w.effect !== null) {
      button.style.background = wordBackground(w.effect, largest);
      button.append(el('small', '', signed(w.effect)));
      button.title = `Removing this word changes the score by ${signed(-w.effect)}`;
    }
    button.addEventListener('click', () => toggleWord(index, button));
    return button;
  }));
  $('words-block').hidden = false;
}
async function toggleWord(index, button) {
  if (state.removed.has(index)) state.removed.delete(index); else state.removed.add(index);
  button.setAttribute('aria-pressed', String(state.removed.has(index)));
  await scoreEdited();
}
async function scoreEdited() {
  const original = state.explained;
  const edited = original.words.map((w) => w.word).filter((_, i) => !state.removed.has(i)).join(' ');
  $('restore-btn').hidden = state.removed.size === 0;
  const id = ++state.requestId;
  if (state.removed.size === 0) {
    renderScore(original, 'Full headline');
    $('shift').hidden = true;
    updateTruth(original);
    return;
  }
  $('truth').hidden = true;
  if (!edited) {
    renderScore({ label: null }, 'All words removed');
    $('shift').hidden = true;
    return;
  }
  try {
    const result = await api('/api/score', { headline: edited });
    if (id !== state.requestId) return;
    const count = state.removed.size;
    renderScore(result, `Without ${count} ${count === 1 ? 'word' : 'words'}`);
    if (result.label) {
      const flipped = result.label !== original.label;
      $('shift').textContent = `Full headline: ${percent(original.prob_fake)}. Now: ${percent(result.prob_fake)}.${flipped ? ' The verdict flipped.' : ''}`;
    }
    $('shift').hidden = !result.label;
  } catch (error) {
    showError('check-error', error.message);
  }
}
async function explain() {
  const text = $('headline').value.trim();
  showError('check-error', '');
  if (!text) {
    showError('check-error', 'Enter a headline first.');
    $('headline').focus();
    return;
  }
  clearTimeout(state.timer);
  const id = ++state.requestId;
  resetWords();
  $('explain-btn').disabled = true;
  $('explain-wait').hidden = false;
  try {
    const result = await api('/api/predict', { headline: text });
    if (id !== state.requestId) return;
    renderScore(result, result.label ? 'Full headline' : 'BERT needs English text');
    updateTruth(result);
    if (result.label) {
      state.explained = result;
      renderWords(result);
      loadRecent();
    }
  } catch (error) {
    if (id === state.requestId) showError('check-error', error.message);
  } finally {
    $('explain-btn').disabled = false;
    $('explain-wait').hidden = true;
  }
}
function openInChecker(text, sample = null) {
  state.sample = sample;
  resetWords();
  $('headline').value = text;
  location.hash = '';
  $('check').scrollIntoView({ block: 'start' });
  liveScore();
}
$('headline').addEventListener('input', () => {
  resetWords();
  clearTimeout(state.timer);
  state.timer = setTimeout(liveScore, 350);
});
$('headline').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); explain(); }
});
$('explain-btn').addEventListener('click', explain);
$('sample-btn').addEventListener('click', async () => {
  showError('check-error', '');
  try {
    state.sample = await api('/api/samples/random');
    $('headline').value = state.sample.headline;
    await explain();
  } catch (error) {
    showError('check-error', error.message);
  }
});
$('clear-btn').addEventListener('click', () => {
  state.sample = null;
  state.requestId += 1;
  clearTimeout(state.timer);
  resetWords();
  $('headline').value = '';
  showError('check-error', '');
  $('truth').hidden = true;
  renderScore(null, 'Waiting for a headline');
  $('headline').focus();
});
$('restore-btn').addEventListener('click', () => {
  state.removed.clear();
  $('words').querySelectorAll('.word').forEach((w) => w.setAttribute('aria-pressed', 'false'));
  scoreEdited();
});

/* ---------- You vs BERT ---------- */
const game = { sample: null, rounds: 0, you: 0, bert: 0 };
function renderScoreboard() {
  $('you-score').textContent = `${game.you} / ${game.rounds}`;
  $('bert-score').textContent = `${game.bert} / ${game.rounds}`;
}
async function nextRound() {
  showError('game-error', '');
  $('game-reveal').hidden = true;
  $('game-guess').hidden = false;
  $('guess-real').disabled = true;
  $('guess-fake').disabled = true;
  try {
    let sample;
    do { sample = await api('/api/samples/random'); } while (game.sample && sample.headline === game.sample.headline);
    game.sample = sample;
    $('game-headline').textContent = sample.headline;
    $('guess-real').disabled = false;
    $('guess-fake').disabled = false;
  } catch (error) {
    showError('game-error', error.message);
  }
}
async function guess(choice) {
  $('guess-real').disabled = true;
  $('guess-fake').disabled = true;
  try {
    const result = await api('/api/score', { headline: game.sample.headline });
    const answer = game.sample.label;
    const youRight = choice === answer;
    const bertRight = result.label === answer;
    game.rounds += 1;
    game.you += youRight ? 1 : 0;
    game.bert += bertRight ? 1 : 0;
    renderScoreboard();
    const outcome = youRight && bertRight ? 'You both got it.'
      : youRight ? 'You beat BERT on this one.'
        : bertRight ? 'BERT got this one, you didn\'t.' : 'You were both wrong.';
    $('game-outcome').textContent = outcome;
    $('game-detail').textContent = `The dataset says ${answer}. BERT said ${result.label}, with a ${percent(result.prob_fake)} probability of fake.`;
    $('game-guess').hidden = true;
    $('game-reveal').hidden = false;
  } catch (error) {
    showError('game-error', error.message);
    $('guess-real').disabled = false;
    $('guess-fake').disabled = false;
  }
}
$('guess-real').addEventListener('click', () => guess('real'));
$('guess-fake').addEventListener('click', () => guess('fake'));
$('game-next').addEventListener('click', nextRound);
$('game-open').addEventListener('click', () => openInChecker(game.sample.headline, game.sample));
$('game-reset').addEventListener('click', () => {
  Object.assign(game, { rounds: 0, you: 0, bert: 0 });
  renderScoreboard();
  nextRound();
});

/* ---------- Many headlines ---------- */
const batch = { results: [], filter: 'all', sort: null };
const batchLines = () => $('batch-input').value.split('\n').map((l) => l.trim()).filter(Boolean);
function updateBatchCount() {
  const count = batchLines().length;
  $('batch-count').textContent = `${count} ${count === 1 ? 'headline' : 'headlines'}`;
}
$('batch-input').addEventListener('input', updateBatchCount);
$('batch-samples').addEventListener('click', async () => {
  showError('batch-error', '');
  try {
    const samples = await Promise.all(Array.from({ length: 5 }, () => api('/api/samples/random')));
    const existing = batchLines();
    $('batch-input').value = [...new Set([...existing, ...samples.map((s) => s.headline)])].join('\n');
    updateBatchCount();
  } catch (error) {
    showError('batch-error', error.message);
  }
});
function renderBatch() {
  const counts = { fake: 0, real: 0, none: 0 };
  batch.results.forEach((r) => { counts[r.label || 'none'] += 1; });
  $('split').replaceChildren(...Object.entries(counts).filter(([, n]) => n > 0).map(([key, n]) => {
    const part = el('i', key);
    part.style.flexGrow = n;
    return part;
  }));
  const options = [['all', `All ${batch.results.length}`], ['fake', `Fake ${counts.fake}`], ['real', `Real ${counts.real}`], ['none', `No result ${counts.none}`]];
  $('batch-filters').replaceChildren(...options.map(([key, text]) => {
    const button = el('button', '', text);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(batch.filter === key));
    button.addEventListener('click', () => { batch.filter = key; renderBatch(); });
    return button;
  }));
  let rows = batch.results.filter((r) => batch.filter === 'all' || (r.label || 'none') === batch.filter);
  if (batch.sort) {
    const direction = batch.sort === 'desc' ? -1 : 1;
    rows = [...rows].sort((a, b) => ((a.prob_fake ?? -1) - (b.prob_fake ?? -1)) * direction);
  }
  $('sort-mark').textContent = batch.sort === 'desc' ? '↓' : batch.sort === 'asc' ? '↑' : '';
  $('batch-rows').replaceChildren(...rows.map((r) => {
    const tr = el('tr');
    const result = el('td');
    result.append(tag(r.label));
    tr.append(el('td', '', r.headline), result, el('td', 'num', r.prob_fake === null ? '-' : percent(r.prob_fake)));
    tr.addEventListener('click', () => openInChecker(r.headline));
    return tr;
  }));
}
$('batch-btn').addEventListener('click', async () => {
  showError('batch-error', '');
  const headlines = batchLines();
  if (!headlines.length) return showError('batch-error', 'Enter at least one headline.');
  if (headlines.length > 200) return showError('batch-error', `You entered ${headlines.length} headlines. The limit is 200.`);
  $('batch-btn').disabled = true;
  $('batch-btn').textContent = 'Checking';
  try {
    batch.results = (await api('/api/predict/batch', { headlines })).results;
    batch.filter = 'all';
    batch.sort = null;
    renderBatch();
    $('batch-results').hidden = false;
  } catch (error) {
    showError('batch-error', error.message);
  } finally {
    $('batch-btn').disabled = false;
    $('batch-btn').textContent = 'Check all';
  }
});
$('batch-sort').addEventListener('click', () => {
  batch.sort = batch.sort === 'desc' ? 'asc' : 'desc';
  renderBatch();
});
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`; // stops spreadsheets running it as a formula
  return `"${text.replace(/"/g, '""')}"`;
}
$('batch-download').addEventListener('click', () => {
  const lines = [['headline', 'result', 'probability_of_fake'],
    ...batch.results.map((r) => [r.headline, r.label ?? 'no result', r.prob_fake ?? ''])];
  const blob = new Blob([`﻿${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}`], { type: 'text/csv' });
  const link = el('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'headline_results.csv';
  link.click();
  URL.revokeObjectURL(link.href);
});

/* ---------- Results explorer ---------- */
const GROUPS = [
  ['All test headlines', () => true],
  ['Excluding synthetic', (a) => !a],
  ['Without giveaway words', (a, g) => !g],
  ['Neither synthetic nor giveaway', (a, g) => !a && !g],
];
const SERIES = [['Precision', 'precision', '--s1'], ['Recall', 'recall', '--s2'], ['F1', 'f1', '--s3']];
const explorer = { scores: null, group: 3, threshold: 0.5, rows: [], curve: [] };

function metricsAt(rows, threshold) {
  let tp = 0; let fp = 0; let fn = 0; let tn = 0;
  for (const [label, prob] of rows) {
    const fake = prob >= threshold;
    if (fake && label) tp += 1; else if (fake) fp += 1; else if (label) fn += 1; else tn += 1;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  return { tp, fp, fn, tn, precision, recall,
    accuracy: (tp + tn) / rows.length,
    f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0 };
}
function selectGroup(index) {
  explorer.group = index;
  const s = explorer.scores;
  const keep = GROUPS[index][1];
  explorer.rows = s.label.map((label, i) => [label, s.prob_fake[i], s.is_augmented[i], s.has_giveaway[i]])
    .filter((r) => keep(r[2], r[3]));
  explorer.curve = [];
  for (let t = 1; t <= 99; t += 2) explorer.curve.push({ t: t / 100, ...metricsAt(explorer.rows, t / 100) });
  $('groups').querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(i === index)));
  renderExplorer();
}
function renderExplorer() {
  const m = metricsAt(explorer.rows, explorer.threshold);
  const base = metricsAt(explorer.rows, 0.5);
  $('threshold-value').textContent = percent(explorer.threshold, 0);
  $('tiles').replaceChildren(...[['Accuracy', 'accuracy'], ['Precision', 'precision'], ['Recall', 'recall'], ['F1-score', 'f1']].map(([name, key]) => {
    const tile = el('div', 'tile');
    tile.dataset.metric = key;
    tile.append(el('span', '', name), el('strong', '', percent(m[key], 2)),
      el('small', '', `${percent(base[key], 2)} at the 50% threshold`));
    return tile;
  }));
  const cell = (count, text, wrong) => {
    const node = el('div', `cell ${wrong ? 'wrong' : ''}`);
    node.append(el('strong', '', count.toLocaleString()), text);
    return node;
  };
  $('matrix').replaceChildren(cell(m.tn, 'real, called real'), cell(m.fp, 'real, called fake', true),
    cell(m.fn, 'fake, called real', true), cell(m.tp, 'fake, called fake'));
  drawChart();
}
const CHART = { w: 620, h: 300, l: 44, r: 16, t: 14, b: 42 };
function drawChart() {
  const svg = $('chart');
  CHART.w = Math.max(280, $('chart-wrap').clientWidth);
  CHART.h = CHART.w < 480 ? 240 : 300;
  const { w, h, l, r, t, b } = CHART;
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const values = explorer.curve.flatMap((p) => [p.precision, p.recall, p.f1]);
  const minY = Math.max(0, Math.floor(Math.min(...values) * 10) / 10);
  const x = (v) => l + v * (w - l - r);
  const y = (v) => t + ((1 - v) / (1 - minY)) * (h - t - b);
  const parts = [];
  const text = (tx, ty, s, anchor = 'middle') => `<text x="${tx}" y="${ty}" text-anchor="${anchor}" fill="var(--muted)" font-size="12">${s}</text>`;
  for (let v = minY; v <= 1.0001; v += (1 - minY) > 0.5 ? 0.2 : 0.1) {
    parts.push(`<line x1="${l}" x2="${w - r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/>`);
    parts.push(text(l - 8, y(v) + 4, `${Math.round(v * 100)}%`, 'end'));
  }
  for (const v of [0, 0.25, 0.5, 0.75, 1]) parts.push(text(x(v), h - b + 18, `${v * 100}%`));
  parts.push(text((l + w - r) / 2, h - 6, 'Decision threshold'));
  for (const [, key, color] of SERIES) {
    const d = explorer.curve.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(' ');
    parts.push(`<path d="${d}" fill="none" stroke="var(${color})" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
  }
  const m = metricsAt(explorer.rows, explorer.threshold);
  const tx = x(explorer.threshold);
  parts.push(`<line x1="${tx}" x2="${tx}" y1="${t}" y2="${h - b}" stroke="var(--fg)" stroke-width="1.5"/>`);
  for (const [, key, color] of SERIES) parts.push(`<circle cx="${tx}" cy="${y(m[key])}" r="4.5" fill="var(${color})" stroke="var(--panel)" stroke-width="2"/>`);
  svg.innerHTML = parts.join('');
}
function chartThreshold(event) {
  const box = $('chart').getBoundingClientRect();
  const px = ((event.clientX - box.left) / box.width) * CHART.w;
  const value = (px - CHART.l) / (CHART.w - CHART.l - CHART.r);
  return { value: Math.min(0.99, Math.max(0.01, Math.round(value * 100) / 100)), left: event.clientX - box.left, width: box.width };
}
function setThreshold(value) {
  explorer.threshold = value;
  $('threshold').value = Math.round(value * 100);
  renderExplorer();
}
$('chart').addEventListener('pointermove', (event) => {
  if (!explorer.rows.length) return;
  const { value, left, width } = chartThreshold(event);
  const m = metricsAt(explorer.rows, value);
  const tip = $('tooltip');
  tip.replaceChildren(el('div', '', `Threshold ${percent(value, 0)}`),
    ...SERIES.map(([name, key]) => el('div', '', `${name} ${percent(m[key])}`)));
  tip.hidden = false;
  const tipWidth = tip.offsetWidth;
  tip.style.left = `${left + 12 + tipWidth > width ? left - tipWidth - 12 : left + 12}px`;
});
addEventListener('resize', () => { if (explorer.rows.length) drawChart(); });
$('chart').addEventListener('pointerleave', () => { $('tooltip').hidden = true; });
$('chart').addEventListener('click', (event) => setThreshold(chartThreshold(event).value));
$('threshold').addEventListener('input', (event) => setThreshold(Number(event.target.value) / 100));

async function loadResults() {
  try {
    const report = await api('/api/model');
    explorer.scores = report.test_scores;
    $('groups').replaceChildren(...GROUPS.map(([name], index) => {
      const button = el('button', '', name);
      button.type = 'button';
      button.addEventListener('click', () => selectGroup(index));
      return button;
    }));
    $('legend').replaceChildren(...SERIES.map(([name, , color]) => {
      const item = el('span');
      const swatch = el('i');
      swatch.style.background = `var(${color})`;
      item.append(swatch, name);
      return item;
    }));
    const d = report.details;
    const best = report.training_log.reduce((a, b) => (b.f1 > a.f1 ? b : a));
    const details = [['Base model', d.model_name], ['Parameters', report.parameters.toLocaleString()],
      ['Input length', `${d.max_len} tokens`], ['Learning rate', String(d.learning_rate)],
      ['Weights kept', `Epoch ${best.epoch} of ${d.epochs}`], ['Validation F1', percent(best.f1, 2)],
      ['Running on', report.device === 'cuda' ? 'GPU' : 'CPU']];
    $('details').replaceChildren(...details.flatMap(([n, v]) => [el('dt', '', n), el('dd', '', v)]));
    selectGroup(0);
  } catch (error) {
    showError('results-error', error.message);
  }
}

/* ---------- Recent checks ---------- */
let recentChecks = [];
function renderRecent() {
  const query = $('recent-search').value.trim().toLowerCase();
  const rows = recentChecks.filter((c) => c.headline.toLowerCase().includes(query));
  $('recent-empty').hidden = recentChecks.length > 0;
  $('recent-clear').disabled = recentChecks.length === 0;
  $('recent-search').disabled = recentChecks.length === 0;
  $('recent-list').replaceChildren(...rows.map((c) => {
    const li = el('li');
    const button = el('button');
    button.type = 'button';
    const time = el('time', '', new Date(c.created_at).toLocaleString());
    button.append(el('span', '', c.headline), tag(c.label), time);
    button.addEventListener('click', () => openInChecker(c.headline));
    li.append(button);
    return li;
  }));
}
async function loadRecent() {
  showError('recent-error', '');
  try {
    recentChecks = (await api('/api/history?limit=100')).checks;
    renderRecent();
  } catch (error) {
    showError('recent-error', error.message);
  }
}
$('recent-search').addEventListener('input', renderRecent);
$('recent-clear').addEventListener('click', () => { $('recent-confirm').hidden = false; });
$('recent-no').addEventListener('click', () => { $('recent-confirm').hidden = true; });
$('recent-yes').addEventListener('click', async () => {
  $('recent-confirm').hidden = true;
  try {
    await api('/api/history', null, 'DELETE');
    await loadRecent();
  } catch (error) {
    showError('recent-error', error.message);
  }
});

/* ---------- Navigation highlight ---------- */
const navLinks = [...document.querySelectorAll('nav a')];
const observer = new IntersectionObserver((entries) => {
  entries.filter((e) => e.isIntersecting).forEach((e) => {
    navLinks.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${e.target.id}`));
  });
}, { rootMargin: '-30% 0px -60% 0px' });
document.querySelectorAll('main section').forEach((s) => observer.observe(s));

/* ---------- Start ---------- */
renderScoreboard();
loadResults();
loadRecent();
nextRound();
api('/api/health').catch(() => setStatus(false));
