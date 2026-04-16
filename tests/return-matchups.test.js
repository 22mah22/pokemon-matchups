const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  loadMatchups,
  loadRulebook,
  applyRulebook,
  normalizePerspective,
  sortMatchups,
  buildOutput,
} = require('../scripts/return-matchups');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'return-matchups-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('JSON parsing validates required schema fields', () => withTempDir((dir) => {
  const badPath = path.join(dir, 'bad.json');
  fs.writeFileSync(badPath, JSON.stringify({
    matchups: [
      { attacker: 'Pikachu', defender: 'Gyarados', outcomeClass: 'win', scoreContribution: 2 },
      { attacker: 'Pikachu', defender: 'Snorlax', outcomeClass: 'INVALID', scoreContribution: 1 },
    ],
  }));

  assert.throws(() => loadMatchups(badPath), /invalid outcomeClass/i);
}));

test('rulebook can exclude and adjust scoring', () => withTempDir((dir) => {
  const matchupsPath = path.join(dir, 'matchups.json');
  const rulebookPath = path.join(dir, 'rulebook.json');

  fs.writeFileSync(matchupsPath, JSON.stringify({
    matchups: [
      { attacker: 'Pikachu', defender: 'Bulbasaur', outcomeClass: 'win', scoreContribution: 2, tags: ['OHKO'] },
      { attacker: 'Pikachu', defender: 'Onix', outcomeClass: 'loss', scoreContribution: -2, tags: [] },
    ],
  }));

  fs.writeFileSync(rulebookPath, JSON.stringify({
    id: 'rules-1',
    name: 'Rules 1',
    rules: [
      {
        id: 'boost-ohko',
        active: true,
        match: { hasTag: 'OHKO' },
        action: { adjustScore: 1 },
      },
      {
        id: 'exclude-onix',
        active: true,
        match: { defender: 'Onix' },
        action: { exclude: true },
      },
    ],
  }));

  const ruled = applyRulebook(loadMatchups(matchupsPath), loadRulebook(rulebookPath), true);
  assert.equal(ruled.length, 1);
  assert.equal(ruled[0].defender, 'Bulbasaur');
  assert.equal(ruled[0].scoreContribution, 3);
  assert.equal(ruled[0].ruleTrace.length, 1);
}));

test('sorting keeps OHKO wins on top and OHKO losses at bottom', () => {
  const sorted = sortMatchups([
    { opponent: 'B', outcomeClass: 'loss', scoreContribution: -1, tags: [] },
    { opponent: 'C', outcomeClass: 'loss', scoreContribution: -5, tags: ['OHKO'] },
    { opponent: 'A', outcomeClass: 'win', scoreContribution: 2, tags: [] },
    { opponent: 'D', outcomeClass: 'win', scoreContribution: 1, tags: ['OHKO'] },
    { opponent: 'E', outcomeClass: 'neutral', scoreContribution: 0, tags: [] },
  ]);

  assert.equal(sorted[0].opponent, 'D');
  assert.equal(sorted.at(-1).opponent, 'C');
});

test('total score is computed after perspective normalization', () => {
  const normalized = normalizePerspective([
    { attacker: 'Pikachu', defender: 'A', outcomeClass: 'win', scoreContribution: 3, tags: [] },
    { attacker: 'B', defender: 'Pikachu', outcomeClass: 'win', scoreContribution: 2, tags: [] },
  ], 'Pikachu');

  const sorted = sortMatchups(normalized);
  const payload = buildOutput({
    pokemon: 'Pikachu',
    rulebook: { id: 'r1', name: 'Rulebook 1' },
    sortedMatchups: sorted,
    sourcePath: 'x.json',
  });

  assert.equal(payload.total_score, 1);
});
