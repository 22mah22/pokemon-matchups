#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {
  KILL_TIERS,
  compareResultsByRulebook,
  parseLibrarySets,
  calculateMatchups,
} = require('./generate-matchups');

const RULEBOOKS = {
  standard_v1: {
    id: 'standard_v1',
    description: 'Scores each normalized result as win=3, tie=1, loss=0.',
    scoring: {
      win: 3,
      tie: 1,
      loss: 0,
    },
    compareDirections: compareResultsByRulebook,
  },
  zero_sum_v1: {
    id: 'zero_sum_v1',
    description: 'Scores each normalized result as win=1, tie=0, loss=-1.',
    scoring: {
      win: 1,
      tie: 0,
      loss: -1,
    },
    compareDirections: compareResultsByRulebook,
  },
  'kill-tier-speed-priority-v1': {
    id: 'kill-tier-speed-priority-v1',
    description: 'Legacy alias of standard_v1; compare best kill tier, speed edge, then damaging priority.',
    scoring: {
      win: 3,
      tie: 1,
      loss: 0,
    },
    compareDirections: compareResultsByRulebook,
  },
};

const KILL_TIER_ORDER = new Map([
  KILL_TIERS.OHKO_GUARANTEED,
  KILL_TIERS.OHKO_POSSIBLE,
  KILL_TIERS.HKO2_GUARANTEED,
  KILL_TIERS.HKO2_POSSIBLE,
  KILL_TIERS.WORSE,
].map((tier, index) => [tier, index]));

function parseArgs(argv) {
  let inputPath;
  let rulebookId;
  let outputPath;

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--input') {
      inputPath = argv[i + 1];
      i += 1;
    } else if (token === '--rulebook') {
      rulebookId = argv[i + 1];
      i += 1;
    } else if (token === '--output') {
      outputPath = argv[i + 1];
      i += 1;
    }
  }

  return { inputPath, rulebookId, outputPath };
}

function normalizeName(value) {
  return String(value || '').trim();
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
          hasDamagingPriorityMove: Boolean(entry.hasDamagingPriorityMove),
          source: 'directional-matchup',
        },
      };
    });
}

function evaluatePair(first, second, rulebook) {
  if (!first || !second) return ['tie', 'tie'];

  const firstShape = {
    attacker: first.pokemon.name,
    defender: first.opponent.name,
    bestKillTier: first.metadata.bestKillTier,
    attackerSpeed: first.metadata.speedAdvantage,
    defenderSpeed: 0,
    hasDamagingPriorityMove: first.metadata.hasDamagingPriorityMove,
  };
  const secondShape = {
    attacker: second.pokemon.name,
    defender: second.opponent.name,
    bestKillTier: second.metadata.bestKillTier,
    attackerSpeed: second.metadata.speedAdvantage,
    defenderSpeed: 0,
    hasDamagingPriorityMove: second.metadata.hasDamagingPriorityMove,
  };

  const compared = rulebook.compareDirections(firstShape, secondShape);
  if (compared < 0) return ['win', 'lose'];
  if (compared > 0) return ['lose', 'win'];
  return ['tie', 'tie'];
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

    const [forwardResult, reverseResult] = evaluatePair(record, reverse, rulebook);
    normalized.push({ ...record, result: forwardResult });

    if (reverse) {
      normalized.push({ ...reverse, result: reverseResult });
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

function main() {
  const { inputPath: inputArg, rulebookId, outputPath: outputArg } = parseArgs(process.argv);
  if (!inputArg || !rulebookId || !outputArg) {
    console.error('Usage: node scripts/rank-matchups.js --input <path> --rulebook <id> --output <path>');
    process.exit(1);
  }

  const rulebook = RULEBOOKS[rulebookId];
  if (!rulebook) {
    console.error(`Unknown rulebook id "${rulebookId}". Available: ${Object.keys(RULEBOOKS).join(', ') || '(none)'}`);
    process.exit(1);
  }

  const inputPath = path.resolve(inputArg);
  const outputPath = path.resolve(outputArg);

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
}

if (require.main === module) {
  main();
}

module.exports = {
  RULEBOOKS,
  parseArgs,
  loadResultsFromInput,
  toNormalizedRecords,
  aggregateRanking,
  buildOutputPayload,
};
