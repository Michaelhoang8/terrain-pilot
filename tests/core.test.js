import test from 'node:test';
import assert from 'node:assert/strict';
import {
  plan,
  example,
  validateMap,
  blockedCells,
  neighbors,
  heuristic,
  pathLedger,
} from '../core.js';
function map(width = 5, height = 5) {
  return {
    width,
    height,
    cells: Array(width * height).fill(1),
    start: 0,
    goal: width * height - 1,
    diagonal: false,
    clearance: 0,
  };
}
function oracle(m) {
  const d = Array(m.cells.length).fill(Infinity),
    blocked = blockedCells(m);
  if (blocked[m.start] || blocked[m.goal]) return Infinity;
  d[m.start] = 0;
  for (let pass = 0; pass < m.cells.length - 1; pass++) {
    let changed = false;
    for (let u = 0; u < d.length; u++)
      for (const { to, cost } of neighbors(m, u, blocked))
        if (d[u] + cost < d[to]) {
          d[to] = d[u] + cost;
          changed = true;
        }
    if (!changed) break;
  }
  return d[m.goal];
}
test('open grids use Manhattan or octile shortest distances', () => {
  const m = map();
  assert.equal(plan(m).cost, 8);
  m.diagonal = true;
  assert.ok(Math.abs(plan(m).cost - 4 * Math.SQRT2) < 1e-10);
  assert.equal(plan({ ...m, start: 12, goal: 12 }).cost, 0);
});
test('expensive terrain favors a longer but cheaper detour', () => {
  const m = map();
  m.start = 10;
  m.goal = 14;
  m.cells[11] = m.cells[12] = m.cells[13] = 9;
  const result = plan(m);
  assert.equal(result.cost, 6);
  assert.ok(result.path.length > 5);
});
test('diagonal motion never cuts a blocked corner', () => {
  const m = map(3, 3);
  m.diagonal = true;
  m.cells[1] = m.cells[3] = 0;
  assert.equal(plan(m).status, 'unreachable');
  assert.deepEqual(neighbors(m, 0), []);
});
test('square footprints inflate obstacles and map boundaries', () => {
  const m = map(7, 7);
  m.clearance = 1;
  m.cells[24] = 0;
  const blocked = blockedCells(m);
  assert.equal(
    blocked.reduce((a, b) => a + b, 0),
    33,
  );
  assert.equal(plan(m).status, 'blocked-endpoint');
  m.start = 8;
  m.goal = 40;
  const detour = plan(m);
  assert.equal(detour.status, 'found');
  assert.equal(detour.cost, 8);
  assert.ok(detour.path.every((id) => !blocked[id]));
});
test('a one-cell passage closes for a three-cell footprint', () => {
  const m = example('clearance');
  assert.equal(plan(m).status, 'found');
  m.clearance = 1;
  assert.equal(plan(m).status, 'unreachable');
});
test('A* and Dijkstra agree with Bellman-Ford on seeded weighted grids', () => {
  let seed = 763;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let trial = 0; trial < 100; trial++) {
    const m = map(7, 6);
    m.cells = m.cells.map(() => (random() < 0.22 ? 0 : 1 + Math.floor(random() * 9)));
    m.cells[m.start] = m.cells[m.goal] = 1;
    m.diagonal = trial % 2 === 0;
    const expected = oracle(m);
    for (const algorithm of ['astar', 'dijkstra']) {
      const result = plan(m, algorithm);
      if (!Number.isFinite(expected)) assert.equal(result.status, 'unreachable');
      else {
        assert.equal(result.status, 'found');
        assert.ok(Math.abs(result.cost - expected) < 1e-8);
        assert.ok(Math.abs(pathLedger(m, result.path).at(-1).cumulative_cost - result.cost) < 1e-8);
      }
    }
  }
});
test('heuristic is consistent across every legal weighted edge', () => {
  for (const diagonal of [false, true]) {
    const m = example('terrain');
    m.diagonal = diagonal;
    for (let u = 0; u < m.cells.length; u++)
      for (const { to, cost } of neighbors(m, u))
        assert.ok(heuristic(m, u) <= cost + heuristic(m, to) + 1e-9);
  }
});
test('A* expands fewer cells on an open grid and traces are deterministic', () => {
  const m = map(30, 30);
  const a = plan(m),
    d = plan(m, 'dijkstra');
  assert.equal(a.cost, d.cost);
  assert.ok(a.expanded < d.expanded / 5);
  assert.deepEqual(a, plan(m));
  assert.equal(new Set(a.steps.map((s) => s.cell)).size, a.expanded);
});
test('validation rejects malformed maps and path ledgers reject illegal moves', () => {
  for (const bad of [
    null,
    { ...map(), extra: true },
    { ...map(), cells: [1] },
    { ...map(), start: -1 },
    { ...map(), clearance: 3 },
    { ...map(), diagonal: 1 },
    { ...map(), width: 41 },
  ])
    assert.throws(() => validateMap(bad));
  assert.throws(() => plan(map(), 'greedy'));
  assert.throws(() => pathLedger(map(), [0, 24]));
  assert.throws(() => pathLedger(map(), []));
});
test('planning never mutates the input map', () => {
  const m = example(),
    before = structuredClone(m);
  plan(m);
  assert.deepEqual(m, before);
  const copy = validateMap(m);
  copy.cells[0] = 9;
  assert.equal(m.cells[0], 1);
});
