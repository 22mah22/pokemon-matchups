const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadRulebook, aggregateRanking } = require('../scripts/rank-matchups');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-matchups-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('loadRulebook accepts JSON file path', () => withTempDir((dir) => {
  const rulebookPath = path.join(dir, 'custom-rulebook.json');
  fs.writeFileSync(rulebookPath, JSON.stringify({
    id: 'custom_v1',
    description: 'Custom scoring rulebook',
    scoring: { win: 5, tie: 2, loss: -3 },
  }));

  const rulebook = loadRulebook(rulebookPath);
  assert.equal(rulebook.id, 'custom_v1');
  assert.equal(rulebook.scoring.win, 5);
  assert.equal(typeof rulebook.compareDirections, 'function');
}));

test('loadRulebook keeps legacy id support', () => {
  const rulebook = loadRulebook('standard_v1');
  assert.equal(rulebook.id, 'standard_v1');
  assert.deepEqual(rulebook.scoring, { win: 3, tie: 1, loss: 0 });
});

test('aggregateRanking uses scoring from loaded rulebook', () => {
  const ranking = aggregateRanking([
    { pokemon: { id: 'pikachu', name: 'Pikachu' }, result: 'win' },
    { pokemon: { id: 'pikachu', name: 'Pikachu' }, result: 'tie' },
    { pokemon: { id: 'bulbasaur', name: 'Bulbasaur' }, result: 'lose' },
  ], {
    scoring: { win: 4, tie: 1, loss: -2 },
  });

  const pikachu = ranking.find((row) => row.pokemon === 'Pikachu');
  assert.equal(pikachu.score, 5);
});
