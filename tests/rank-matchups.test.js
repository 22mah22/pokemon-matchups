const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  aggregateRanking,
  aggregateWeightedRanking,
  buildPokemonJustificationPayloads,
  buildWeightedOutputPayload,
  computeWeightedWinPoints,
  loadResultsFromInput,
  toNormalizedRecords,
  sanitizePokemonFileName,
  sortJustificationDecisionsByOpponentRanking,
  weightedOutputPathForInput,
  writePokemonJustificationFiles,
} = require('../scripts/rank-matchups');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-matchups-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function fixtureNormalizedRecords() {
  return [
    {
      pokemon: { id: 'mr.mime/../', name: 'Mr. Mime' },
      opponent: { id: 'snorlax', name: 'Snorlax' },
      result: 'win',
      metadata: {
        bestKillTier: 'OHKO_GUARANTEED',
        canOhko: true,
        canGuaranteed2hko: true,
        canPossible2hko: true,
        speedAdvantage: 12,
      },
      decisionTrace: [{
        ruleId: 'ohko',
        metric: 'canOhko',
        firstCan: true,
        secondCan: false,
        speedTiebreak: true,
        firstSpeedAdvantage: 12,
        secondSpeedAdvantage: -12,
        resolved: true,
        resolution: 'first-win-second-lose',
      }],
    },
    {
      pokemon: { id: 'mr.mime/../', name: 'Mr. Mime' },
      opponent: { id: 'alakazam', name: 'Alakazam' },
      result: 'lose',
      metadata: {
        bestKillTier: 'HKO2_GUARANTEED',
        canOhko: false,
        canGuaranteed2hko: true,
        canPossible2hko: true,
        speedAdvantage: -5,
      },
      decisionTrace: [{
        ruleId: 'hko2-guaranteed',
        metric: 'canGuaranteed2hko',
        firstCan: true,
        secondCan: true,
        speedTiebreak: true,
        firstSpeedAdvantage: -5,
        secondSpeedAdvantage: 5,
        resolved: true,
        resolution: 'first-lose-second-win-speed',
      }],
    },
    {
      pokemon: { id: 'gengar', name: 'Gengar' },
      opponent: { id: 'snorlax', name: 'Snorlax' },
      result: 'tie',
      metadata: {
        bestKillTier: 'WORSE',
        canOhko: false,
        canGuaranteed2hko: false,
        canPossible2hko: false,
        speedAdvantage: 0,
      },
      decisionTrace: [{
        ruleId: 'default-tie',
        resolved: true,
        resolution: 'tie',
      }],
    },
  ];
}

test('sanitizePokemonFileName strips traversal and illegal characters', () => {
  assert.equal(sanitizePokemonFileName('../Mr Mime:??'), 'mr_mime');
  assert.equal(sanitizePokemonFileName('   '), 'pokemon');
  assert.equal(sanitizePokemonFileName('Nidoran♀'), 'nidoran');
});

test('writePokemonJustificationFiles writes one file per ranked pokemon in provided directory', () => withTempDir((dir) => {
  const payloads = buildPokemonJustificationPayloads(
    'fixtures/input.json',
    { id: 'rank-rules', scoring: { win: 2, tie: 0, loss: -1 } },
    fixtureNormalizedRecords(),
  );

  const outputDir = writePokemonJustificationFiles(dir, payloads);
  assert.equal(outputDir, path.resolve(dir));

  const writtenFiles = fs.readdirSync(dir).sort();
  assert.deepEqual(writtenFiles, ['gengar.json', 'mr_mime.json']);
  assert.equal(writtenFiles.length, payloads.length);
}));

test('justification files include summary W/L and per-opponent decision trace fields', () => withTempDir((dir) => {
  const payloads = buildPokemonJustificationPayloads(
    'fixtures/input.json',
    { id: 'rank-rules', scoring: { win: 2, tie: 0, loss: -1 } },
    fixtureNormalizedRecords(),
  );
  writePokemonJustificationFiles(dir, payloads);

  const mrMimePayload = JSON.parse(fs.readFileSync(path.join(dir, 'mr_mime.json'), 'utf8'));
  assert.equal(mrMimePayload.summary.wins, 1);
  assert.equal(mrMimePayload.summary.losses, 1);
  assert.equal(mrMimePayload.summary.ties, 0);
  assert.equal(mrMimePayload.summary.score, 1);
  assert.equal(mrMimePayload.decisions.length, 2);

  const firstDecision = mrMimePayload.decisions[0];
  assert.equal(firstDecision.result, 'win');
  assert.equal(firstDecision.opponent.id, 'snorlax');
  assert.ok(Array.isArray(firstDecision.explanationTrace));
  assert.ok(firstDecision.explanationTrace.length > 0);
  assert.ok(Object.hasOwn(firstDecision.explanationTrace[0], 'metric'));
  assert.ok(Object.hasOwn(firstDecision.explanationTrace[0], 'firstCan'));
  assert.ok(Object.hasOwn(firstDecision.explanationTrace[0], 'secondCan'));
  assert.ok(Object.hasOwn(firstDecision.explanationTrace[0], 'speedTiebreak'));
  assert.ok(Object.hasOwn(firstDecision.explanationTrace[0], 'firstSpeedAdvantage'));
  assert.ok(Object.hasOwn(firstDecision.explanationTrace[0], 'secondSpeedAdvantage'));
  assert.ok(Object.hasOwn(firstDecision.explanationTrace[0], 'resolution'));
}));

test('sortJustificationDecisionsByOpponentRanking orders wins first and losses by highest ranked opponent', () => {
  const normalized = [
    {
      pokemon: { id: 'a', name: 'A' },
      opponent: { id: 'b', name: 'B' },
      result: 'win',
      metadata: {},
      decisionTrace: [],
    },
    {
      pokemon: { id: 'a', name: 'A' },
      opponent: { id: 'c', name: 'C' },
      result: 'win',
      metadata: {},
      decisionTrace: [],
    },
    {
      pokemon: { id: 'a', name: 'A' },
      opponent: { id: 'd', name: 'D' },
      result: 'lose',
      metadata: {},
      decisionTrace: [],
    },
    {
      pokemon: { id: 'a', name: 'A' },
      opponent: { id: 'e', name: 'E' },
      result: 'lose',
      metadata: {},
      decisionTrace: [],
    },
    { pokemon: { id: 'b', name: 'B' }, opponent: { id: 'a', name: 'A' }, result: 'lose', metadata: {}, decisionTrace: [] },
    { pokemon: { id: 'c', name: 'C' }, opponent: { id: 'a', name: 'A' }, result: 'lose', metadata: {}, decisionTrace: [] },
    { pokemon: { id: 'd', name: 'D' }, opponent: { id: 'a', name: 'A' }, result: 'win', metadata: {}, decisionTrace: [] },
    { pokemon: { id: 'e', name: 'E' }, opponent: { id: 'a', name: 'A' }, result: 'win', metadata: {}, decisionTrace: [] },
  ];
  const rulebook = { scoring: { win: 1, tie: 0, loss: -1 } };
  const ranking = aggregateRanking(normalized, rulebook);
  const payloads = buildPokemonJustificationPayloads('fixtures/input.json', { id: 'rules', ...rulebook }, normalized);
  const sorted = sortJustificationDecisionsByOpponentRanking(payloads, ranking);
  const aPayload = sorted.find((item) => item.pokemon.id === 'a');

  assert.deepEqual(
    aPayload.decisions.map((decision) => `${decision.result}:${decision.opponent.name}`),
    ['win:B', 'win:C', 'lose:D', 'lose:E'],
  );
});

test('loadResultsFromInput rejects JSON library payloads that only contain sets', () => withTempDir((dir) => {
  const inputPath = path.join(dir, 'library.json');
  fs.writeFileSync(inputPath, JSON.stringify({
    sets: [
      {
        pokemon: 'Pikachu',
        set: 'Pikachu @ Light Ball\nAbility: Static\n- Thunderbolt',
      },
    ],
  }));

  assert.throws(
    () => loadResultsFromInput(inputPath, { battleLevel: 50 }),
    /must include a "results" array/i,
  );
}));

test('toNormalizedRecords preserves multiple sets that share a species name via attackerId/defenderId', () => {
  const normalized = toNormalizedRecords([
    {
      attacker: 'Blastoise-Mega (Set 1)',
      attackerId: 'blastoise-mega#1',
      defender: 'Venusaur-Mega',
      defenderId: 'venusaur-mega',
      attackerSpeed: 120,
      defenderSpeed: 100,
      moves: [{ ohkoGuaranteed: true, ohkoPossible: true, hko2Guaranteed: true, hko2Possible: true }],
    },
    {
      attacker: 'Venusaur-Mega',
      attackerId: 'venusaur-mega',
      defender: 'Blastoise-Mega (Set 1)',
      defenderId: 'blastoise-mega#1',
      attackerSpeed: 100,
      defenderSpeed: 120,
      moves: [{ ohkoGuaranteed: false, ohkoPossible: false, hko2Guaranteed: false, hko2Possible: false }],
    },
    {
      attacker: 'Blastoise-Mega (Set 2)',
      attackerId: 'blastoise-mega#2',
      defender: 'Venusaur-Mega',
      defenderId: 'venusaur-mega',
      attackerSpeed: 110,
      defenderSpeed: 100,
      moves: [{ ohkoGuaranteed: false, ohkoPossible: true, hko2Guaranteed: true, hko2Possible: true }],
    },
    {
      attacker: 'Venusaur-Mega',
      attackerId: 'venusaur-mega',
      defender: 'Blastoise-Mega (Set 2)',
      defenderId: 'blastoise-mega#2',
      attackerSpeed: 100,
      defenderSpeed: 110,
      moves: [{ ohkoGuaranteed: false, ohkoPossible: false, hko2Guaranteed: false, hko2Possible: false }],
    },
  ], {
    outcomeRules: [{ id: 'ohko-guaranteed', metric: 'canGuaranteedOhko', speedTiebreak: true }],
  });

  const ranking = aggregateRanking(normalized, { scoring: { win: 1, tie: 0, loss: -1 } });
  const blastoiseRows = ranking.filter((row) => row.pokemon.startsWith('Blastoise-Mega'));
  assert.equal(blastoiseRows.length, 2);
});

test('computeWeightedWinPoints gives 3 for top rank and 1 for last rank', () => {
  assert.equal(computeWeightedWinPoints(1, 10), 3);
  assert.equal(computeWeightedWinPoints(10, 10), 1);
  assert.equal(computeWeightedWinPoints(5, 10), 1 + (2 * ((10 - 5) / 9)));
});

test('aggregateWeightedRanking uses unweighted ranking order for win weighting', () => {
  const normalized = [
    { pokemon: { id: 'x', name: 'X' }, opponent: { id: 'a', name: 'A' }, result: 'win' },
    { pokemon: { id: 'x', name: 'X' }, opponent: { id: 'c', name: 'C' }, result: 'win' },
    { pokemon: { id: 'a', name: 'A' }, opponent: { id: 'x', name: 'X' }, result: 'lose' },
    { pokemon: { id: 'c', name: 'C' }, opponent: { id: 'x', name: 'X' }, result: 'lose' },
  ];
  const ranking = [
    { pokemon: 'A', score: 10 },
    { pokemon: 'B', score: 8 },
    { pokemon: 'C', score: 4 },
  ];
  const weighted = aggregateWeightedRanking(normalized, ranking);

  const rowX = weighted.find((row) => row.pokemon === 'X');
  assert.equal(rowX.weightedScore, 4);
});

test('weighted output filename is based on input matchups filename', () => {
  const weightedPath = weightedOutputPathForInput('/tmp/matchups/champions_ou_matchups.json');
  assert.equal(weightedPath, '/tmp/matchups/champions_ou_matchups_weighted.json');
});

test('buildWeightedOutputPayload emits weighted ranking fields', () => {
  const payload = buildWeightedOutputPayload(
    'matchups/champions_ou_matchups.json',
    { id: 'rules', description: 'desc', battleLevel: 50, scoring: { win: 1, tie: 0, loss: 0 } },
    [{}, {}],
    [{ pokemon: 'A', score: 10 }, { pokemon: 'B', score: 8 }],
    [{ pokemon: 'A', weightedScore: 3 }, { pokemon: 'B', weightedScore: 1 }],
  );

  assert.equal(payload.totals.normalizedCount, 2);
  assert.equal(payload.ranking[0].weightedScore, 3);
  assert.equal(payload.weightedFromRanking[0].rank, 1);
});
