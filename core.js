export function validateMap(input) {
  const keys = ['width', 'height', 'cells', 'start', 'goal', 'diagonal', 'clearance'];
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(input, k))
  )
    throw Error('Map needs width, height, cells, start, goal, diagonal, and clearance only.');
  for (const key of ['width', 'height'])
    if (!Number.isInteger(input[key]) || input[key] < 3 || input[key] > 40)
      throw Error('Map dimensions must be integers from 3 to 40.');
  const size = input.width * input.height;
  if (
    !Array.isArray(input.cells) ||
    input.cells.length !== size ||
    input.cells.some((value) => !Number.isInteger(value) || value < 0 || value > 9)
  )
    throw Error('Cells must contain one integer from 0 to 9 per map position.');
  for (const key of ['start', 'goal'])
    if (!Number.isInteger(input[key]) || input[key] < 0 || input[key] >= size)
      throw Error('Start and goal must be valid cell indices.');
  if (
    typeof input.diagonal !== 'boolean' ||
    !Number.isInteger(input.clearance) ||
    input.clearance < 0 ||
    input.clearance > 2
  )
    throw Error('Use a boolean diagonal option and clearance from 0 to 2.');
  return { ...input, cells: [...input.cells] };
}
export function blockedCells(map) {
  const { width, height, clearance: r, cells } = map,
    blocked = new Uint8Array(cells.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const id = y * width + x;
      if (x < r || y < r || x >= width - r || y >= height - r) {
        blocked[id] = 1;
        continue;
      }
      outer: for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++)
          if (cells[(y + dy) * width + x + dx] === 0) {
            blocked[id] = 1;
            break outer;
          }
    }
  return blocked;
}
export function neighbors(map, id, blocked = blockedCells(map)) {
  const x = id % map.width,
    y = Math.floor(id / map.width),
    result = [];
  if (blocked[id]) return result;
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    ...(map.diagonal
      ? [
          [1, 1],
          [-1, 1],
          [-1, -1],
          [1, -1],
        ]
      : []),
  ]) {
    const nx = x + dx,
      ny = y + dy;
    if (nx < 0 || nx >= map.width || ny < 0 || ny >= map.height) continue;
    const to = ny * map.width + nx;
    if (blocked[to] || (dx && dy && (blocked[y * map.width + nx] || blocked[ny * map.width + x])))
      continue;
    result.push({ to, cost: map.cells[to] * (dx && dy ? Math.SQRT2 : 1) });
  }
  return result;
}
export function heuristic(map, id) {
  const dx = Math.abs((id % map.width) - (map.goal % map.width)),
    dy = Math.abs(Math.floor(id / map.width) - Math.floor(map.goal / map.width));
  return map.diagonal ? Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy) : dx + dy;
}
class Heap {
  data = [];
  less(a, b) {
    return (
      a.priority < b.priority ||
      (a.priority === b.priority && (a.h < b.h || (a.h === b.h && a.order < b.order)))
    );
  }
  push(item) {
    const a = this.data;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(a[i], a[parent])) break;
      [a[i], a[parent]] = [a[parent], a[i]];
      i = parent;
    }
  }
  pop() {
    const a = this.data,
      first = a[0],
      last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      while (true) {
        let best = i,
          left = 2 * i + 1,
          right = left + 1;
        if (left < a.length && this.less(a[left], a[best])) best = left;
        if (right < a.length && this.less(a[right], a[best])) best = right;
        if (best === i) break;
        [a[i], a[best]] = [a[best], a[i]];
        i = best;
      }
    }
    return first;
  }
}
export function plan(input, algorithm = 'astar') {
  const map = validateMap(input);
  if (!['astar', 'dijkstra'].includes(algorithm)) throw Error('Choose astar or dijkstra.');
  const blocked = blockedCells(map),
    steps = [],
    base = {
      algorithm,
      steps,
      path: [],
      cost: null,
      expanded: 0,
      discovered: 0,
      blocked: Array.from(blocked),
    };
  if (blocked[map.start] || blocked[map.goal]) return { ...base, status: 'blocked-endpoint' };
  const distances = new Float64Array(map.cells.length).fill(Infinity),
    previous = new Int32Array(map.cells.length).fill(-1),
    closed = new Uint8Array(map.cells.length),
    queue = new Heap();
  let order = 0,
    discovered = 1;
  const h = (id) => (algorithm === 'astar' ? heuristic(map, id) : 0);
  distances[map.start] = 0;
  queue.push({ id: map.start, g: 0, h: h(map.start), priority: h(map.start), order: order++ });
  while (queue.data.length) {
    const current = queue.pop(),
      id = current.id;
    if (closed[id] || current.g !== distances[id]) continue;
    closed[id] = 1;
    const event = { cell: id, cost: current.g, discovered: [] };
    steps.push(event);
    if (id === map.goal) {
      const path = [];
      for (let at = id; at !== -1; at = previous[at]) path.push(at);
      path.reverse();
      return {
        ...base,
        status: 'found',
        path,
        cost: distances[id],
        expanded: steps.length,
        discovered,
      };
    }
    for (const edge of neighbors(map, id, blocked)) {
      const candidate = current.g + edge.cost;
      if (!closed[edge.to] && candidate < distances[edge.to]) {
        if (!Number.isFinite(distances[edge.to])) {
          discovered++;
          event.discovered.push(edge.to);
        }
        distances[edge.to] = candidate;
        previous[edge.to] = id;
        const estimate = h(edge.to);
        queue.push({
          id: edge.to,
          g: candidate,
          h: estimate,
          priority: candidate + estimate,
          order: order++,
        });
      }
    }
  }
  return { ...base, status: 'unreachable', expanded: steps.length, discovered };
}
export function pathLedger(input, path) {
  const map = validateMap(input),
    blocked = blockedCells(map);
  if (!Array.isArray(path) || !path.length || path[0] !== map.start || path.at(-1) !== map.goal)
    throw Error('Path must connect start to goal.');
  let total = 0;
  return path.map((id, index) => {
    if (!Number.isInteger(id) || id < 0 || id >= map.cells.length || blocked[id])
      throw Error('Path includes a blocked or invalid cell.');
    if (index) {
      const edge = neighbors(map, path[index - 1], blocked).find((e) => e.to === id);
      if (!edge) throw Error('Path contains an illegal move.');
      total += edge.cost;
    }
    return {
      step: index,
      x: id % map.width,
      y: Math.floor(id / map.width),
      terrain: map.cells[id],
      cumulative_cost: total,
    };
  });
}
export function example(name = 'warehouse') {
  const width = 24,
    height = 16,
    cells = Array(width * height).fill(1),
    map = {
      width,
      height,
      cells,
      start: 2 * width + 2,
      goal: 13 * width + 21,
      diagonal: false,
      clearance: 0,
    };
  if (name === 'warehouse') {
    for (const x of [6, 12, 18])
      for (let y = 2; y < 14; y++) if (y !== 5 && y !== 10) cells[y * width + x] = 0;
    for (let y = 7; y < 11; y++) for (let x = 1; x < 6; x++) cells[y * width + x] = 5;
  } else if (name === 'terrain') {
    for (let y = 0; y < height; y++)
      for (let x = 9; x < 15; x++) cells[y * width + x] = y >= 11 ? 1 : 7;
    map.diagonal = true;
  } else if (name === 'clearance') {
    for (let y = 0; y < height; y++) if (y !== 8) cells[y * width + 12] = 0;
    map.start = 8 * width + 3;
    map.goal = 8 * width + 20;
  } else if (name !== 'empty') throw Error('Unknown example.');
  return map;
}
