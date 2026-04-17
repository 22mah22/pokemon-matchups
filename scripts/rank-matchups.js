#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {
  KILL_TIERS,
  parseLibrarySets,
  calculateMatchups,
} = require('./generate-matchups');

const KILL_TIER_ORDER = new Map([
  KILL_TIERS.OHKO_GUARANTEED,
  KILL_TIERS.OHKO_POSSIBLE,
  KILL_TIERS.HKO2_GUARANTEED,
  KILL_TIERS.HKO2_POSSIBLE,
  KILL_TIERS.WORSE,
].map((tier, index) => [tier, index]));

function parseArgs(argv) {
  let inputPath;
  let rulebookPath;
  let outputPath;
  let justificationsDir;
  let justificationsDirProvided = false;

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--input') {
      inputPath = argv[i + 1];
      i += 1;
    } else if (token === '--rulebook') {
      rulebookPath = argv[i + 1];
      i += 1;
    } else if (token === '--output') {
      outputPath = argv[i + 1];
      i += 1;
    } else if (token === '--justifications-dir') {
      justificationsDirProvided = true;
      justificationsDir = argv[i + 1];
      i += 1;
    }
  }

  return {
    inputPath,
    rulebookPath,
    outputPath,
    justificationsDir,
    justificationsDirProvided,
  };
}

function normalizeName(value) {
  return String(value || '').trim();
}

function loadRulebook(rulebookPath) {
  const raw = fs.readFileSync(rulebookPath, 'utf8');
  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Rulebook JSON must be an object.');
  }

  const id = normalizeName(parsed.id || parsed.name || path.basename(rulebookPath, path.extname(rulebookPath)));
  const description = normalizeName(parsed.description || parsed.name || id);
  const scoring = parsed.scoring && typeof parsed.scoring === 'object' ? parsed.scoring : {};

  const normalizedScoring = {
    win: Number(scoring.win),
    tie: Number(scoring.tie),
    loss: Number(scoring.loss),
  };

  if (!Number.isFinite(normalizedScoring.win)
    || !Number.isFinite(normalizedScoring.tie)
    || !Number.isFinite(normalizedScoring.loss)) {
    throw new Error('Rulebook scoring must include numeric win, tie, and loss values.');
  }

  const defaultOutcomeRules = [
    { id: 'ohko', metric: 'canOhko', speedTiebreak: true },
    { id: 'hko2-guaranteed', metric: 'canGuaranteed2hko', speedTiebreak: true },
    { id: 'hko2-potential', metric: 'canPossible2hko', speedTiebreak: true },
  ];

  const outcomeRules = Array.isArray(parsed.outcomeRules) && parsed.outcomeRules.length > 0
    ? parsed.outcomeRules
    : defaultOutcomeRules;

  return {
    id,
    description,
    scoring: normalizedScoring,
    outcomeRules,
  };
}

function toDirectionalEntries(results, rulebook) {
  return results
    .filter((entry) => entry && entry.attacker && entry.defender)
    .map((entry) => {
      const speedAdvantage = Number(entry.attackerSpeed || 0) - Number(entry.defenderSpeed || 0);
      return {
        pokemon: {
          id: normalizeName(entry.attacker).toLowerCase(),
          name: normalizeName(entry.attacker),
        },
        opponent: {
          id: normalizeName(entry.defender).toLowerCase(),
          name: normalizeName(entry.defender),
        },
        result: 'tie',
        metadata: {
          rulebookId: rulebook.id,
          bestKillTier: entry.bestKillTier || KILL_TIERS.WORSE,
          bestKillTierRank: KILL_TIER_ORDER.get(entry.bestKillTier || KILL_TIERS.WORSE),
          speedAdvantage,
          canOhko: entry.moves?.some((move) => move?.ohkoPossible === true) || false,
          canGuaranteed2hko: entry.moves?.some((move) => move?.hko2Guaranteed === true) || false,
          canPossible2hko: entry.moves?.some((move) => move?.hko2Possible === true) || false,
          source: 'directional-matchup',
        },
      };
    });
}

function evaluatePair(first, second, rulebook) {
  return evaluatePairWithTrace(first, second, rulebook).results;
}

function evaluatePairWithTrace(first, second, rulebook) {
  const trace = [];

  if (!first || !second) {
    return {
      results: ['tie', 'tie'],
      trace: [
        {
          ruleId: 'missing-reverse-record',
          resolved: true,
          resolution: 'tie',
        },
      ],
    };
  }

  for (const step of rulebook.outcomeRules) {
    const metric = normalizeName(step?.metric);
    if (!metric) continue;

    const firstCan = Boolean(first.metadata?.[metric]);
    const secondCan = Boolean(second.metadata?.[metric]);

    const traceStep = {
      ruleId: normalizeName(step?.id || metric),
      metric,
      firstCan,
      secondCan,
      speedTiebreak: Boolean(step?.speedTiebreak),
      resolved: false,
      resolution: null,
    };

    if (firstCan && !secondCan) {
      traceStep.resolved = true;
      traceStep.resolution = 'first-win-second-lose';
      trace.push(traceStep);
      return { results: ['win', 'lose'], trace };
    }
    if (!firstCan && secondCan) {
      traceStep.resolved = true;
      traceStep.resolution = 'first-lose-second-win';
      trace.push(traceStep);
      return { results: ['lose', 'win'], trace };
    }

    if (firstCan && secondCan && Boolean(step?.speedTiebreak)) {
      const firstSpeedAdvantage = Number(first.metadata?.speedAdvantage) || 0;
      const secondSpeedAdvantage = Number(second.metadata?.speedAdvantage) || 0;
      traceStep.firstSpeedAdvantage = firstSpeedAdvantage;
      traceStep.secondSpeedAdvantage = secondSpeedAdvantage;

      if (firstSpeedAdvantage > secondSpeedAdvantage) {
        traceStep.resolved = true;
        traceStep.resolution = 'first-win-second-lose-speed';
        trace.push(traceStep);
        return { results: ['win', 'lose'], trace };
      }
      if (firstSpeedAdvantage < secondSpeedAdvantage) {
        traceStep.resolved = true;
        traceStep.resolution = 'first-lose-second-win-speed';
        trace.push(traceStep);
        return { results: ['lose', 'win'], trace };
      }
    }

    traceStep.resolution = 'fallthrough';
    trace.push(traceStep);
  }

  return {
    results: ['tie', 'tie'],
    trace: [
      ...trace,
      {
        ruleId: 'default-tie',
        resolved: true,
        resolution: 'tie',
      },
    ],
  };
}

function toNormalizedRecords(results, rulebook) {
  const directional = toDirectionalEntries(results, rulebook);
  const byKey = new Map();

  for (const record of directional) {
    const key = `${record.pokemon.id}->${record.opponent.id}`;
    byKey.set(key, record);
  }

  const visitedPairs = new Set();
  const normalized = [];

  for (const record of directional) {
    const pairKey = [record.pokemon.id, record.opponent.id].sort().join('|');
    if (visitedPairs.has(pairKey)) continue;
    visitedPairs.add(pairKey);

    const reverseKey = `${record.opponent.id}->${record.pokemon.id}`;
    const reverse = byKey.get(reverseKey);

    const evaluation = evaluatePairWithTrace(record, reverse, rulebook);
    const [forwardResult, reverseResult] = evaluation.results;
    const reverseTrace = evaluation.trace.map((step) => ({
      ...step,
      firstCan: typeof step.firstCan === 'boolean' ? step.secondCan : step.firstCan,
      secondCan: typeof step.secondCan === 'boolean' ? step.firstCan : step.secondCan,
      firstSpeedAdvantage: Number.isFinite(step.secondSpeedAdvantage)
        ? step.secondSpeedAdvantage
        : step.firstSpeedAdvantage,
      secondSpeedAdvantage: Number.isFinite(step.firstSpeedAdvantage)
        ? step.firstSpeedAdvantage
        : step.secondSpeedAdvantage,
    }));

    normalized.push({ ...record, result: forwardResult, decisionTrace: evaluation.trace });

    if (reverse) {
      normalized.push({ ...reverse, result: reverseResult, decisionTrace: reverseTrace });
    }
  }

  return normalized;
}

function loadResultsFromInput(inputPath) {
  const ext = path.extname(inputPath).toLowerCase();

  if (ext === '.txt') {
    const sets = parseLibrarySets(inputPath);
    return calculateMatchups(sets).results;
  }

  if (ext !== '.json') {
    throw new Error(`Unsupported input extension "${ext}". Use .json or .txt.`);
  }

  const raw = fs.readFileSync(inputPath, 'utf8');
  const parsed = JSON.parse(raw);

  if (parsed && Array.isArray(parsed.results)) {
    return parsed.results;
  }

  if (parsed && Array.isArray(parsed.sets)) {
    const sets = parseLibrarySets(inputPath);
    return calculateMatchups(sets).results;
  }

  throw new Error('JSON input must include either a "results" array (matchups) or a "sets" array (library).');
}

function aggregateRanking(normalized, rulebook) {
  const table = new Map();

  for (const record of normalized) {
    const key = record.pokemon.id;
    if (!table.has(key)) {
      table.set(key, {
        pokemon: record.pokemon.name,
        wins: 0,
        losses: 0,
        ties: 0,
        score: 0,
        total: 0,
        winRate: 0,
      });
    }
    const row = table.get(key);
    if (record.result === 'win') row.wins += 1;
    else if (record.result === 'lose') row.losses += 1;
    else row.ties += 1;

    const scoringResult = record.result === 'lose' ? 'loss' : record.result;
    row.score += rulebook.scoring[scoringResult] ?? 0;
    row.total += 1;
  }

  const ranked = [...table.values()].map((row) => {
    const denominator = row.wins + row.losses;
    const winRate = denominator > 0 ? row.wins / denominator : 0;
    return {
      pokemon: row.pokemon,
      wins: row.wins,
      losses: row.losses,
      ties: row.ties,
      score: row.score,
      total: row.total,
      winRate,
    };
  });

  ranked.sort((a, b) => (
    (b.score - a.score)
      || (b.winRate - a.winRate)
      || (b.wins - a.wins)
      || a.pokemon.localeCompare(b.pokemon)
  ));

  return ranked;
}

function ensureParentDirectory(filePath) {
  const outputDir = path.dirname(filePath);
  fs.mkdirSync(outputDir, { recursive: true });
}

function defaultJustificationsDirForOutput(outputPath) {
  const outputDir = path.dirname(outputPath);
  const outputBaseName = path.basename(outputPath, path.extname(outputPath));
  const folderBase = sanitizePokemonFileName(outputBaseName) || 'ranking';
  return path.join(outputDir, `${folderBase}_justifications`);
}

function buildOutputPayload(inputArg, rulebook, normalized, ranking) {
  return {
    rulebook: {
      id: rulebook.id,
      description: rulebook.description,
      scoring: rulebook.scoring,
    },
    generatedAt: new Date().toISOString(),
    input: inputArg,
    totals: {
      normalizedCount: normalized.length,
      pokemonCount: ranking.length,
    },
    stats: ranking,
    ranking: ranking.map((row, index) => ({
      rank: index + 1,
      pokemon: row.pokemon,
      score: row.score,
    })),
  };
}

function buildPokemonJustificationPayloads(inputArg, rulebook, normalized) {
  const byPokemon = new Map();

  for (const record of normalized) {
    const key = record.pokemon.id;
    if (!byPokemon.has(key)) {
      byPokemon.set(key, {
        pokemon: {
          id: record.pokemon.id,
          name: record.pokemon.name,
        },
        generatedAt: new Date().toISOString(),
        source: {
          input: inputArg,
          rulebook: {
            id: rulebook.id,
          },
        },
        summary: {
          wins: 0,
          losses: 0,
          ties: 0,
          score: 0,
        },
        decisions: [],
      });
    }

    const payload = byPokemon.get(key);
    if (record.result === 'win') payload.summary.wins += 1;
    else if (record.result === 'lose') payload.summary.losses += 1;
    else payload.summary.ties += 1;

    const scoringResult = record.result === 'lose' ? 'loss' : record.result;
    payload.summary.score += rulebook.scoring[scoringResult] ?? 0;

    payload.decisions.push({
      opponent: {
        id: record.opponent.id,
        name: record.opponent.name,
      },
      result: record.result,
      metadata: {
        bestKillTier: record.metadata?.bestKillTier,
        canOhko: Boolean(record.metadata?.canOhko),
        canGuaranteed2hko: Boolean(record.metadata?.canGuaranteed2hko),
        canPossible2hko: Boolean(record.metadata?.canPossible2hko),
        speedAdvantage: Number(record.metadata?.speedAdvantage) || 0,
      },
      explanationTrace: Array.isArray(record.decisionTrace)
        ? record.decisionTrace.map((step) => ({
          ruleId: step.ruleId,
          metric: step.metric,
          firstCan: step.firstCan,
          secondCan: step.secondCan,
          speedTiebreak: step.speedTiebreak,
          firstSpeedAdvantage: step.firstSpeedAdvantage,
          secondSpeedAdvantage: step.secondSpeedAdvantage,
          resolved: Boolean(step.resolved),
          resolution: step.resolution,
        }))
        : [],
    });
  }

  return [...byPokemon.values()];
}

function sortJustificationDecisionsByOpponentRanking(justificationPayloads, ranking) {
  const rankByPokemonName = new Map(
    ranking.map((row, index) => [normalizeName(row?.pokemon).toLowerCase(), index + 1]),
  );
  const resultPriority = new Map([
    ['win', 0],
    ['lose', 1],
    ['tie', 2],
  ]);

  return justificationPayloads.map((payload) => {
    const decisions = Array.isArray(payload?.decisions) ? [...payload.decisions] : [];

    decisions.sort((a, b) => {
      const resultRankA = resultPriority.get(a?.result) ?? 99;
      const resultRankB = resultPriority.get(b?.result) ?? 99;
      if (resultRankA !== resultRankB) return resultRankA - resultRankB;

      const opponentRankA = rankByPokemonName.get(normalizeName(a?.opponent?.name).toLowerCase()) ?? Number.POSITIVE_INFINITY;
      const opponentRankB = rankByPokemonName.get(normalizeName(b?.opponent?.name).toLowerCase()) ?? Number.POSITIVE_INFINITY;
      if (opponentRankA !== opponentRankB) return opponentRankA - opponentRankB;

      return normalizeName(a?.opponent?.name).localeCompare(normalizeName(b?.opponent?.name));
    });

    return {
      ...payload,
      decisions,
    };
  });
}

function sanitizePokemonFileName(nameOrId) {
  const sanitized = String(nameOrId || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return sanitized || 'pokemon';
}

function writePokemonJustificationFiles(justificationsDir, groupedPayloads) {
  const outputDir = path.resolve(justificationsDir);
  fs.mkdirSync(outputDir, { recursive: true });

  for (const item of groupedPayloads) {
    const filename = `${sanitizePokemonFileName(item?.pokemon?.id)}.json`;
    const filePath = path.join(outputDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(item, null, 2));
  }

  return outputDir;
}

function main() {
  const {
    inputPath: inputArg,
    rulebookPath: rulebookArg,
    outputPath: outputArg,
    justificationsDir: justificationsDirArg,
    justificationsDirProvided,
  } = parseArgs(process.argv);
  if (!inputArg || !rulebookArg || !outputArg) {
    console.error([
      'Usage: node scripts/rank-matchups.js --input <path> --rulebook <path> --output <path>',
      'Optional: --justifications-dir <path> to override default output-adjacent justification directory.',
    ].join('\n'));
    process.exit(1);
  }

  if (justificationsDirProvided && (!justificationsDirArg || justificationsDirArg.startsWith('--'))) {
    console.error([
      'Invalid --justifications-dir value.',
      'Usage: node scripts/rank-matchups.js --input <path> --rulebook <path> --output <path>',
      'Optional: --justifications-dir <path> to override default output-adjacent justification directory.',
    ].join('\n'));
    process.exit(1);
  }

  const inputPath = path.resolve(inputArg);
  const rulebookPath = path.resolve(rulebookArg);
  const outputPath = path.resolve(outputArg);
  const justificationsDir = path.resolve(
    justificationsDirArg || defaultJustificationsDirForOutput(outputPath),
  );

  const rulebook = loadRulebook(rulebookPath);
  const results = loadResultsFromInput(inputPath);
  const normalized = toNormalizedRecords(results, rulebook);

  if (normalized.length === 0) {
    console.error(`No normalized matchup records found from input: ${inputArg}`);
    process.exit(1);
  }

  const ranking = aggregateRanking(normalized, rulebook);
  const payload = buildOutputPayload(inputArg, rulebook, normalized, ranking);

  ensureParentDirectory(outputPath);
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ranking file: ${outputArg}`);

  const justificationPayloads = sortJustificationDecisionsByOpponentRanking(
    buildPokemonJustificationPayloads(inputArg, rulebook, normalized),
    ranking,
  );
  writePokemonJustificationFiles(justificationsDir, justificationPayloads);
  console.log(`Wrote ${justificationPayloads.length} justification files: ${justificationsDir}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  loadRulebook,
  loadResultsFromInput,
  toNormalizedRecords,
  aggregateRanking,
  buildOutputPayload,
  buildPokemonJustificationPayloads,
  sortJustificationDecisionsByOpponentRanking,
  sanitizePokemonFileName,
  defaultJustificationsDirForOutput,
  writePokemonJustificationFiles,
};
