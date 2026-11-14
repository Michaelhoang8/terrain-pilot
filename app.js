import { validateMap, blockedCells, plan, pathLedger, example } from './core.js';
const $ = (id) => document.getElementById(id),
  canvas = $('map'),
  ctx = canvas.getContext('2d'),
  el = (tag, text) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };
let map = example(),
  selected = 0,
  results = null,
  cursor = 0,
  frame = null,
  lastFrame = 0,
  history = [],
  future = [],
  stroke = null,
  lastPaint = -1,
  importRevision = 0;
function stop() {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  $('pause').disabled = true;
}
function sync() {
  const density = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = map.width * 32 * density;
  canvas.height = map.height * 32 * density;
  ctx.setTransform(density, 0, 0, density, 0, 0);
  canvas.style.setProperty('--map-ratio', map.width / map.height);
  $('clearance').value = String(map.clearance);
  $('diagonal').checked = map.diagonal;
  $('x').max = map.width - 1;
  $('y').max = map.height - 1;
  $('map-title').textContent = `${map.width} columns / ${map.height} rows`;
  selected = Math.min(selected, map.cells.length - 1);
  $('undo').disabled = !history.length;
  $('redo').disabled = !future.length;
}
function invalidate(message = 'Map changed. Plan again to update the route.') {
  stop();
  results = null;
  cursor = 0;
  importRevision++;
  $('comparison').replaceChildren();
  $('ledger').replaceChildren();
  $('status').textContent = message;
  $('progress').max = 1;
  $('progress').value = 0;
  $('position').value = '0 / 0';
  $('csv').disabled = $('report').disabled = true;
  draw();
}
function remember(previous) {
  history.push(previous);
  if (history.length > 100) history.shift();
  future = [];
  sync();
}
function replace(next) {
  remember(structuredClone(map));
  map = validateMap(next);
  sync();
  invalidate();
}
function draw() {
  const blocked = blockedCells(map),
    active = results?.[$('algorithm').value],
    expanded = new Set(),
    frontier = new Set(active ? [map.start] : []);
  if (active)
    for (const event of active.steps.slice(0, cursor)) {
      expanded.add(event.cell);
      frontier.delete(event.cell);
      for (const id of event.discovered) if (!expanded.has(id)) frontier.add(id);
    }
  for (let id = 0; id < map.cells.length; id++) {
    const x = (id % map.width) * 32,
      y = Math.floor(id / map.width) * 32,
      weight = map.cells[id];
    ctx.fillStyle =
      weight === 0
        ? '#65564a'
        : blocked[id]
          ? '#b6afa2'
          : weight > 1
            ? `hsl(38 42% ${91 - weight * 3}%)`
            : '#f7f1e6';
    ctx.fillRect(x, y, 32, 32);
    if (weight === 0) {
      ctx.fillStyle = '#ffffff20';
      ctx.fillRect(x + 1, y + 1, 30, 3);
      ctx.fillStyle = '#291e1840';
      ctx.fillRect(x + 1, y + 28, 30, 3);
    }
    if (expanded.has(id)) {
      ctx.fillStyle = '#c5c9ad';
      ctx.fillRect(x + 2, y + 2, 28, 28);
    } else if (frontier.has(id)) {
      ctx.fillStyle = '#e4c99d';
      ctx.fillRect(x + 2, y + 2, 28, 28);
    }
    ctx.strokeStyle = '#dcd3c4';
    ctx.lineWidth = 0.6;
    ctx.strokeRect(x + 0.3, y + 0.3, 31.4, 31.4);
    if (weight > 1 && !blocked[id]) {
      ctx.fillStyle = '#8a774c';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(weight), x + 16, y + 20);
    }
  }
  if (active?.status === 'found' && cursor === active.steps.length) {
    ctx.beginPath();
    active.path.forEach((id, index) => {
      const x = (id % map.width) * 32 + 16,
        y = Math.floor(id / map.width) * 32 + 16;
      index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = '#fff8e8';
    ctx.lineWidth = 8;
    ctx.stroke();
    const routeColor = ctx.createLinearGradient(0, 0, map.width * 32, map.height * 32);
    routeColor.addColorStop(0, '#9b602e');
    routeColor.addColorStop(1, '#d67b36');
    ctx.strokeStyle = routeColor;
    ctx.lineWidth = 4;
    ctx.stroke();
    for (let i = 2; i < active.path.length; i += 3) {
      const from = active.path[i - 1],
        to = active.path[i],
        ax = (from % map.width) * 32 + 16,
        ay = Math.floor(from / map.width) * 32 + 16,
        bx = (to % map.width) * 32 + 16,
        by = Math.floor(to / map.width) * 32 + 16,
        angle = Math.atan2(by - ay, bx - ax);
      ctx.save();
      ctx.translate((ax + bx) / 2, (ay + by) / 2);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(-3, -4);
      ctx.lineTo(1, 0);
      ctx.lineTo(-3, 4);
      ctx.strokeStyle = '#fff8e8';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
  }
  if (active && cursor > 0 && cursor < active.steps.length) {
    const current = active.steps[cursor - 1].cell;
    ctx.beginPath();
    ctx.arc(
      (current % map.width) * 32 + 16,
      Math.floor(current / map.width) * 32 + 16,
      10,
      0,
      Math.PI * 2,
    );
    ctx.strokeStyle = '#65754b';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  for (const [id, color, label] of [
    [map.start, '#7e8a5c', 'S'],
    [map.goal, '#c87845', 'G'],
  ]) {
    const x = (id % map.width) * 32 + 16,
      y = Math.floor(id / map.width) * 32 + 16;
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y + 4);
  }
  const x = selected % map.width,
    y = Math.floor(selected / map.width);
  ctx.strokeStyle = '#c87845';
  ctx.lineWidth = 2;
  ctx.strokeRect(x * 32 + 2, y * 32 + 2, 28, 28);
  $('cell-info').textContent =
    `Cell ${x}, ${y} · ${map.cells[selected] === 0 ? 'obstacle' : blocked[selected] ? 'footprint excluded' : 'cost ' + map.cells[selected]}`;
  $('x').value = x;
  $('y').value = y;
}
function apply(id, record = true) {
  const brush = $('brush').value;
  if (brush === '0' && (id === map.start || id === map.goal)) {
    $('status').textContent = 'Move the start or goal before painting an obstacle there.';
    return;
  }
  const previous = structuredClone(map);
  if (brush === 'start' || brush === 'goal') {
    map[brush] = id;
    if (map.cells[id] === 0) map.cells[id] = 1;
  } else map.cells[id] = Number(brush);
  if (JSON.stringify(previous) === JSON.stringify(map)) return;
  if (record) remember(previous);
  invalidate();
}
function pointerCell(event) {
  const rect = canvas.getBoundingClientRect(),
    x = Math.floor(((event.clientX - rect.left) / rect.width) * map.width),
    y = Math.floor(((event.clientY - rect.top) / rect.height) * map.height);
  return x >= 0 && y >= 0 && x < map.width && y < map.height ? y * map.width + x : null;
}
canvas.onpointerdown = (event) => {
  if (event.button !== 0) return;
  const id = pointerCell(event);
  if (id === null) return;
  canvas.focus();
  canvas.setPointerCapture(event.pointerId);
  stroke = structuredClone(map);
  lastPaint = id;
  selected = id;
  apply(id, false);
  draw();
};
canvas.onpointermove = (event) => {
  const id = pointerCell(event);
  if (id === null) return;
  selected = id;
  if (stroke && id !== lastPaint) {
    lastPaint = id;
    apply(id, false);
  }
  draw();
};
function finishStroke() {
  if (stroke && JSON.stringify(stroke) !== JSON.stringify(map)) remember(stroke);
  stroke = null;
  lastPaint = -1;
}
canvas.onpointerup = finishStroke;
canvas.onpointercancel = finishStroke;
canvas.onkeydown = (event) => {
  const x = selected % map.width,
    y = Math.floor(selected / map.width);
  const moves = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (moves[event.key]) {
    event.preventDefault();
    const [dx, dy] = moves[event.key];
    selected =
      Math.max(0, Math.min(map.height - 1, y + dy)) * map.width +
      Math.max(0, Math.min(map.width - 1, x + dx));
    draw();
  } else if (['Enter', ' '].includes(event.key)) {
    event.preventDefault();
    apply(selected);
  }
};
$('apply').onclick = () => {
  const x = Number($('x').value),
    y = Number($('y').value);
  if (
    !$('x').value ||
    !$('y').value ||
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= map.width ||
    y >= map.height
  ) {
    $('status').textContent = 'Choose a valid integer row and column.';
    return;
  }
  selected = y * map.width + x;
  apply(selected);
  draw();
};
$('undo').onclick = () => {
  if (!history.length) return;
  future.push(structuredClone(map));
  map = history.pop();
  sync();
  invalidate('Map edit undone. Plan again to update the route.');
};
$('redo').onclick = () => {
  if (!future.length) return;
  history.push(structuredClone(map));
  map = future.pop();
  sync();
  invalidate('Map edit restored. Plan again to update the route.');
};
$('example').onchange = () => replace(example($('example').value));
$('clearance').onchange = () => replace({ ...map, clearance: Number($('clearance').value) });
$('diagonal').onchange = () => replace({ ...map, diagonal: $('diagonal').checked });
$('algorithm').onchange = () => invalidate('Planner changed. Plan again to compare searches.');
function seek(value) {
  if (!results) return;
  const active = results[$('algorithm').value];
  cursor = Math.max(0, Math.min(active.steps.length, value));
  $('progress').max = Math.max(1, active.steps.length);
  $('progress').value = cursor;
  $('position').value = `${cursor} / ${active.steps.length}`;
  const finished = cursor === active.steps.length;
  $('csv').disabled = !finished || active.status !== 'found';
  $('report').disabled = !finished;
  $('status').textContent = !finished
    ? `Exploration replay · ${cursor} expanded cells. The complete plan is summarized below.`
    : active.status === 'found'
      ? `Route found · ${active.path.length - 1} moves · cost ${active.cost.toFixed(3)}.`
      : active.status === 'blocked-endpoint'
        ? 'Start or goal is excluded by an obstacle or the selected footprint.'
        : 'No route connects start to goal with these constraints.';
  draw();
}
function calculate() {
  stop();
  const output = {};
  for (const algorithm of ['astar', 'dijkstra']) {
    const start = performance.now();
    output[algorithm] = { ...plan(map, algorithm), milliseconds: performance.now() - start };
  }
  results = output;
  const active = results[$('algorithm').value];
  $('comparison').replaceChildren();
  for (const [algorithm, label] of [
    ['astar', 'A* / heuristic search'],
    ['dijkstra', 'DIJKSTRA / uniform-cost search'],
  ]) {
    const result = results[algorithm],
      card = el('article');
    card.append(
      el('h3', label),
      el('strong', result.cost === null ? 'No route' : result.cost.toFixed(3) + ' cost'),
      el('p', `${result.expanded} expanded · ${result.discovered} discovered`),
      el('p', `${result.milliseconds.toFixed(2)} ms on this browser`),
    );
    $('comparison').append(card);
  }
  $('ledger').replaceChildren();
  if (active.path.length)
    for (const item of pathLedger(map, active.path)) {
      const row = el('tr');
      for (const value of [
        item.step,
        item.x,
        item.y,
        item.terrain,
        item.cumulative_cost.toFixed(3),
      ])
        row.append(el('td', value));
      $('ledger').append(row);
    }
  seek(active.steps.length);
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
    canvas.animate([{ opacity: 0.65 }, { opacity: 1 }], { duration: 280, easing: 'ease-out' });
}
$('plan').onclick = calculate;
$('progress').oninput = () => {
  stop();
  seek(Number($('progress').value));
};
$('step').onclick = () => {
  stop();
  if (!results) {
    calculate();
    seek(0);
  }
  const active = results[$('algorithm').value];
  seek(cursor === active.steps.length ? Math.min(1, active.steps.length) : cursor + 1);
};
$('replay').onclick = () => {
  stop();
  if (!results) calculate();
  const active = results[$('algorithm').value];
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    seek(active.steps.length);
    return;
  }
  seek(0);
  if (!active.steps.length) return;
  $('pause').disabled = false;
  lastFrame = 0;
  function tick(time) {
    if (time - lastFrame >= 40) {
      lastFrame = time;
      seek(cursor + 3);
    }
    if (cursor < active.steps.length) frame = requestAnimationFrame(tick);
    else stop();
  }
  frame = requestAnimationFrame(tick);
};
$('pause').onclick = stop;
function download(value, name, type = 'application/json') {
  const url = URL.createObjectURL(
      new Blob([type === 'application/json' ? JSON.stringify(value, null, 2) : value], { type }),
    ),
    a = el('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
$('save-map').onclick = () => download(map, 'terrain-map.json');
$('report').onclick = () => {
  if (results) download({ map, results }, 'terrain-comparison.json');
};
$('csv').onclick = () => {
  const active = results?.[$('algorithm').value];
  if (active?.path.length) {
    const rows = pathLedger(map, active.path);
    download(
      'step,column,row,terrain,cumulative_cost\r\n' +
        rows.map((r) => [r.step, r.x, r.y, r.terrain, r.cumulative_cost].join(',')).join('\r\n'),
      'terrain-route.csv',
      'text/csv',
    );
  }
};
$('import').onchange = async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  const ticket = ++importRevision;
  try {
    if (file.size > 32000) throw Error('Map JSON must be smaller than 32 KB.');
    const next = validateMap(JSON.parse(await file.text()));
    if (ticket !== importRevision) return;
    replace(next);
    $('status').textContent = 'Map imported. Plan a route when ready.';
  } catch (error) {
    if (ticket === importRevision) $('status').textContent = `Import failed: ${error.message}`;
  }
};
sync();
calculate();

for (const name of ['edit', 'analysis', 'files']) {
  $(name + '-open').addEventListener('click', () => {
    stop();
    $(name + '-panel').showModal();
  });
  $(name + '-close').addEventListener('click', () => $(name + '-panel').close());
}

new MutationObserver(() => {
  $('edit-status').textContent = $('status').textContent;
}).observe($('status'), { childList: true, characterData: true, subtree: true });
