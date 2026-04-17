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
  buildPairwiseRowsForSelectedPokemon,
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

test('sorting is driven by calculationOffset descending', () => {
  const sorted = sortMatchups([
    { opponent: 'Delta', result: 1, scoreContribution: 5, calculationOffset: 2, tags: ['OHKO'] },
    { opponent: 'Alpha', result: 0, scoreContribution: 1, calculationOffset: 2, tags: [] },
    { opponent: 'Bravo', result: 1, scoreContribution: 3, calculationOffset: 0, tags: [] },
    { opponent: 'Echo', result: 1, scoreContribution: 9, calculationOffset: -1, tags: [] },
    { opponent: 'Charlie', result: 0, scoreContribution: -10, calculationOffset: -4, tags: ['OHKO'] },
  ]);

  assert.deepEqual(
    sorted.map((row) => row.opponent),
    ['Alpha', 'Delta', 'Bravo', 'Echo', 'Charlie'],
  );
});

test('total_wins counts only binary wins from output rows', () => {
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

  assert.equal(payload.total_wins, 0);
});

test('output rows are binary and include calc output for both directions', () => {
  const payload = buildOutput({
    pokemon: 'Pikachu',
    rulebook: { id: 'r1', name: 'Rulebook 1' },
    sourcePath: 'x.json',
    sortedMatchups: [{
      pokemon: 'Pikachu',
      opponent: 'Raichu',
      result: 1,
      calcOutputFromAttacker: '252 SpA Pikachu Thunderbolt vs. 0 HP / 0 SpD Raichu: 90-106 (31 - 36.5%) -- 72.6% chance to 3HKO',
      calcOutputFromDefender: '252 SpA Raichu Thunderbolt vs. 0 HP / 0 SpD Pikachu: 93-110 (38.5 - 45.6%) -- guaranteed 3HKO',
      directionalOutcomeClassFromAttacker: 'win',
      directionalOutcomeClassFromDefender: 'loss',
      ruleTrace: [{ ruleId: 'sample', excluded: false, scoreDelta: 0 }],
    }],
  });

  assert.equal(payload.total_wins, 1);
  assert.equal(payload.matchups[0].result, 1);
  assert.ok(!Object.hasOwn(payload.matchups[0], 'scoreContribution'));
  assert.equal(payload.matchups[0].calc_output.Pikachu_to_Raichu.includes('Pikachu Thunderbolt'), true);
  assert.equal(payload.matchups[0].calc_output.Raichu_to_Pikachu.includes('Raichu Thunderbolt'), true);
});

test('pairwise rows emit one row per opponent and synthesize self when missing', () => {
  const rows = buildPairwiseRowsForSelectedPokemon([
    { attacker: 'Pikachu', defender: 'A', outcomeClass: 'win', scoreContribution: 2, tags: [], ruleTrace: [] },
    { attacker: 'A', defender: 'Pikachu', outcomeClass: 'loss', scoreContribution: -2, tags: [], ruleTrace: [] },
    { attacker: 'B', defender: 'Pikachu', outcomeClass: 'win', scoreContribution: 3, tags: [], ruleTrace: [] },
  ], 'Pikachu');

  assert.equal(rows.length, 3);
  assert.equal(rows.filter((row) => row.opponent === 'A').length, 1);

  const self = rows.find((row) => row.opponent === 'Pikachu');
  assert.ok(self);
  assert.equal(self.scoreContribution, 0);
  assert.equal(self.result, 0);
  assert.equal(self.offset, 0);
  assert.equal(self.calculationFromAttacker, 0);
  assert.equal(self.calculationFromDefender, 0);
});

test('pairwise rows include self row as tie with zero offset', () => {
  const rows = buildPairwiseRowsForSelectedPokemon([
    { attacker: 'Pikachu', defender: 'Charizard', outcomeClass: 'win', scoreContribution: 1, tags: [], ruleTrace: [] },
    { attacker: 'Charizard', defender: 'Pikachu', outcomeClass: 'loss', scoreContribution: -1, tags: [], ruleTrace: [] },
  ], 'Pikachu');

  const self = rows.find((row) => row.opponent === 'Pikachu');
  assert.ok(self);
  assert.equal(self.result, 0);
  assert.equal(self.calculationOffset, 0);
  assert.equal(self.directionalOutcomeClassFromAttacker, 'self/tie');
  assert.equal(self.directionalOutcomeClassFromDefender, 'self/tie');
});
