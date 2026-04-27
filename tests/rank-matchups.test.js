const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  aggregateRanking,
  buildPokemonJustificationPayloads,
  loadResultsFromInput,
  sanitizePokemonFileName,
  sortJustificationDecisionsByOpponentRanking,
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
