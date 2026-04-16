#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const VALID_OUTCOME_CLASSES = new Set(['win', 'loss', 'draw', 'neutral']);

function parseArgs(argv) {
  const args = {
    command: null,
    matchupsPath: null,
    rulebookPath: null,
    pokemon: null,
    outputPath: null,
    trace: false,
    includeLegacyFields: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--') && !args.command) {
      args.command = token;
      continue;
    }
    if (token === '--matchups') {
      args.matchupsPath = argv[i + 1];
      i += 1;
    } else if (token === '--rulebook') {
      args.rulebookPath = argv[i + 1];
      i += 1;
    } else if (token === '--pokemon') {
      args.pokemon = argv[i + 1];
      i += 1;
    } else if (token === '--output') {
      args.outputPath = argv[i + 1];
      i += 1;
    } else if (token === '--trace') {
      args.trace = true;
    } else if (token === '--include-legacy-fields') {
      args.includeLegacyFields = true;
    }
  }

  return args;
}

function normalizeName(value) {
  return String(value || '').trim();
}

function parseTxtMatchups(rawText) {
  const lines = rawText.split(/\r?\n/);
  const rows = [];

  for (const line of lines) {
    const header = line.trim().match(/^(.+?)\s*->\s*(.+)$/);
    if (!header) continue;
    rows.push({
      attacker: normalizeName(header[1]),
      defender: normalizeName(header[2]),
      outcomeClass: 'neutral',
      scoreContribution: 0,
      tags: ['SOURCE_TXT'],
    });
  }

  return rows;
}

function validateMatchupEntry(entry, index) {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`Matchup entry at index ${index} must be an object.`);
  }

  const attacker = normalizeName(entry.attacker);
  const defender = normalizeName(entry.defender);
  const outcomeClass = String(entry.outcomeClass || '').trim().toLowerCase();
  const scoreContribution = Number(entry.scoreContribution);

  if (!attacker) throw new Error(`Matchup entry at index ${index} is missing attacker.`);
  if (!defender) throw new Error(`Matchup entry at index ${index} is missing defender.`);
  if (!VALID_OUTCOME_CLASSES.has(outcomeClass)) {
    throw new Error(`Matchup entry at index ${index} has invalid outcomeClass "${entry.outcomeClass}".`);
  }
  if (!Number.isFinite(scoreContribution)) {
    throw new Error(`Matchup entry at index ${index} has non-numeric scoreContribution.`);
  }

  let tags = [];
  if (entry.tags != null) {
    if (!Array.isArray(entry.tags) || entry.tags.some((tag) => typeof tag !== 'string')) {
      throw new Error(`Matchup entry at index ${index} has invalid tags; expected string array.`);
    }
    tags = [...new Set(entry.tags.map((tag) => tag.trim()).filter(Boolean))];
  }

  return {
    attacker,
    defender,
    outcomeClass,
    scoreContribution,
    tags,
  };
}

function legacyResultToModel(entry) {
  const attacker = normalizeName(entry.attacker);
  const defender = normalizeName(entry.defender);
  if (!attacker || !defender) return null;

  const killTier = String(entry.bestKillTier || '').toUpperCase();
  const speedAdvantage = Number(entry.attackerSpeed || 0) - Number(entry.defenderSpeed || 0);
  const hasPriority = Boolean(entry.hasDamagingPriorityMove);

  let outcomeClass = 'neutral';
  let scoreContribution = 0;
  const tags = [];

  if (killTier === 'OHKO_GUARANTEED' || killTier === 'OHKO_POSSIBLE') {
    outcomeClass = 'win';
    scoreContribution = killTier === 'OHKO_GUARANTEED' ? 4 : 3;
    tags.push('OHKO');
  } else if (killTier === 'HKO2_GUARANTEED') {
    outcomeClass = 'win';
    scoreContribution = 2;
  } else if (killTier === 'HKO2_POSSIBLE') {
    outcomeClass = 'win';
    scoreContribution = 1;
  } else if (killTier === 'WORSE') {
    outcomeClass = 'loss';
    scoreContribution = -2;
  }

  if (hasPriority) {
    tags.push('PRIORITY_MOVE');
    scoreContribution += 0.25;
  }
  if (speedAdvantage > 0) {
    tags.push('SPEED_EDGE');
    scoreContribution += 0.25;
  } else if (speedAdvantage < 0) {
    tags.push('SPEED_DISADVANTAGE');
    scoreContribution -= 0.25;
  }

  if (killTier) {
    tags.push(`KILL_TIER_${killTier}`);
  }

  return {
    attacker,
    defender,
    outcomeClass,
    scoreContribution,
    tags,
  };
}

function loadMatchups(matchupsPath) {
  const ext = path.extname(matchupsPath).toLowerCase();
  const raw = fs.readFileSync(matchupsPath, 'utf8');

  if (ext === '.txt') {
    return parseTxtMatchups(raw).map((entry, index) => validateMatchupEntry(entry, index));
  }

  if (ext !== '.json') {
    throw new Error(`Unsupported matchups extension "${ext}". Use .json or .txt.`);
  }

  const parsed = JSON.parse(raw);
  let entries = null;

  if (Array.isArray(parsed)) {
    entries = parsed;
  } else if (parsed && Array.isArray(parsed.matchups)) {
    entries = parsed.matchups;
  } else if (parsed && Array.isArray(parsed.results)) {
    entries = parsed.results.map(legacyResultToModel).filter(Boolean);
  }

  if (!entries) {
    throw new Error('Matchups JSON must be an array, or include "matchups" array, or legacy "results" array.');
  }

  return entries.map((entry, index) => validateMatchupEntry(entry, index));
}

function loadRulebook(rulebookPath) {
  const raw = fs.readFileSync(rulebookPath, 'utf8');
  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Rulebook JSON must be an object.');
  }

  const id = normalizeName(parsed.id || parsed.name || path.basename(rulebookPath, path.extname(rulebookPath)));
  const name = normalizeName(parsed.name || id);
  const rules = Array.isArray(parsed.rules) ? parsed.rules : [];

  return { id, name, rules };
}

function entryMatchesRule(entry, rule) {
  const match = rule && typeof rule.match === 'object' && rule.match ? rule.match : {};

  if (match.attacker && normalizeName(match.attacker).toLowerCase() !== entry.attacker.toLowerCase()) return false;
  if (match.defender && normalizeName(match.defender).toLowerCase() !== entry.defender.toLowerCase()) return false;
  if (match.outcomeClass && String(match.outcomeClass).toLowerCase() !== entry.outcomeClass) return false;

  if (match.hasTag && !entry.tags.includes(String(match.hasTag))) return false;
  if (Array.isArray(match.anyTags) && match.anyTags.length > 0) {
    const wanted = new Set(match.anyTags.map(String));
    if (!entry.tags.some((tag) => wanted.has(tag))) return false;
  }

  return true;
}

function applyRulebook(matchups, rulebook, traceEnabled = false) {
  const activeRules = rulebook.rules.filter((rule) => rule && rule.active !== false);

  return matchups.flatMap((entry) => {
    let current = { ...entry, tags: [...entry.tags] };
    const traces = [];

    for (const rule of activeRules) {
      if (!entryMatchesRule(current, rule)) continue;

      const action = rule.action && typeof rule.action === 'object' ? rule.action : {};
      const trace = {
        ruleId: normalizeName(rule.id || rule.name || 'unnamed-rule'),
        excluded: false,
        scoreDelta: Number(action.adjustScore || 0),
      };

      if (Array.isArray(action.addTags)) {
        current.tags = [...new Set([...current.tags, ...action.addTags.map(String)])];
      }

      if (Number.isFinite(Number(action.adjustScore))) {
        current.scoreContribution += Number(action.adjustScore);
      }

      if (action.setOutcomeClass) {
        const candidate = String(action.setOutcomeClass).toLowerCase();
        if (!VALID_OUTCOME_CLASSES.has(candidate)) {
          throw new Error(`Rule "${trace.ruleId}" sets invalid outcomeClass "${action.setOutcomeClass}".`);
        }
        current.outcomeClass = candidate;
      }

      if (action.exclude === true) {
        trace.excluded = true;
        if (traceEnabled) traces.push(trace);
        return [];
      }

      if (traceEnabled) traces.push(trace);
    }

    if (traceEnabled) {
      current.ruleTrace = traces;
    }

    return [current];
  });
}

function invertOutcomeClass(outcomeClass) {
  if (outcomeClass === 'win') return 'loss';
  if (outcomeClass === 'loss') return 'win';
  return outcomeClass;
}

function normalizePerspective(matchups, pokemon) {
  const wanted = normalizeName(pokemon).toLowerCase();

  return matchups
    .filter((entry) => (
      entry.attacker.toLowerCase() === wanted
      || entry.defender.toLowerCase() === wanted
    ))
    .map((entry) => {
      if (entry.attacker.toLowerCase() === wanted) {
        return {
          pokemon: entry.attacker,
          opponent: entry.defender,
          directionalOutcomeClass: entry.outcomeClass,
          scoreContribution: entry.scoreContribution,
          tags: entry.tags,
          ruleTrace: entry.ruleTrace || [],
        };
      }

      return {
        pokemon: normalizeName(pokemon),
        opponent: entry.attacker,
        directionalOutcomeClass: invertOutcomeClass(entry.outcomeClass),
        scoreContribution: entry.scoreContribution * -1,
        tags: entry.tags,
        ruleTrace: entry.ruleTrace || [],
      };
    });
}

function deriveBinaryResult(calculationFromAttacker, calculationFromDefender) {
  if (!Number.isFinite(calculationFromAttacker) || !Number.isFinite(calculationFromDefender)) {
    return 0;
  }

  return calculationFromAttacker > calculationFromDefender ? 1 : 0;
}

function pairKeyDirectional(attackerId, defenderId) {
  return `${normalizeName(attackerId).toLowerCase()}->${normalizeName(defenderId).toLowerCase()}`;
}

function pairKeyUnordered(firstId, secondId) {
  return [normalizeName(firstId).toLowerCase(), normalizeName(secondId).toLowerCase()].sort().join('::');
}

function normalizePairRows(rowsFromPerspective, pokemon, opponent) {
  if (rowsFromPerspective.length === 0) {
    return {
      pokemon,
      opponent,
      scoreContribution: 0,
      tags: ['PAIR_TIE'],
      ruleTrace: [],
      result: 0,
      offset: 0,
      calculationFromAttacker: 0,
      calculationFromDefender: 0,
      directionalOutcomeClassFromAttacker: 'self/tie',
      directionalOutcomeClassFromDefender: 'self/tie',
    };
  }

  if (rowsFromPerspective.length === 1) {
    const [row] = rowsFromPerspective;
    return {
      ...row,
      result: deriveBinaryResult(row.scoreContribution, Number.NaN),
      offset: row.scoreContribution,
      calculationFromAttacker: row.scoreContribution,
      calculationFromDefender: Number.NaN,
      directionalOutcomeClassFromAttacker: row.directionalOutcomeClass,
      directionalOutcomeClassFromDefender: 'missing',
    };
  }

  const [first, second] = rowsFromPerspective;
  const averagedScore = (first.scoreContribution + second.scoreContribution) / 2;
  const mergedTags = [...new Set([...first.tags, ...second.tags, 'PAIR_NORMALIZED'])];
  const mergedRuleTrace = [...first.ruleTrace, ...second.ruleTrace];

  return {
    pokemon,
    opponent,
    scoreContribution: averagedScore,
    tags: mergedTags,
    ruleTrace: mergedRuleTrace,
    result: deriveBinaryResult(first.scoreContribution, second.scoreContribution),
    offset: averagedScore,
    calculationFromAttacker: first.scoreContribution,
    calculationFromDefender: second.scoreContribution,
    directionalOutcomeClassFromAttacker: first.directionalOutcomeClass,
    directionalOutcomeClassFromDefender: second.directionalOutcomeClass,
  };
}

function buildPairwiseRowsForSelectedPokemon(matchups, pokemon) {
  const selectedPokemon = normalizeName(pokemon);
  const wanted = selectedPokemon.toLowerCase();

  const directionalRows = new Map();
  for (const row of matchups) {
    directionalRows.set(pairKeyDirectional(row.attacker, row.defender), row);
  }

  const opponentsByKey = new Map();
  for (const row of matchups) {
    const attackerId = row.attacker.toLowerCase();
    const defenderId = row.defender.toLowerCase();
    if (attackerId === wanted) {
      opponentsByKey.set(defenderId, row.defender);
    }
    if (defenderId === wanted) {
      opponentsByKey.set(attackerId, row.attacker);
    }
  }
  opponentsByKey.set(wanted, selectedPokemon);

  const emittedPairs = new Set();
  const rows = [];

  for (const [opponentKey, opponentName] of opponentsByKey.entries()) {
    const pairKey = pairKeyUnordered(wanted, opponentKey);
    if (emittedPairs.has(pairKey)) continue;
    emittedPairs.add(pairKey);

    const forward = directionalRows.get(pairKeyDirectional(selectedPokemon, opponentName));
    const reverse = directionalRows.get(pairKeyDirectional(opponentName, selectedPokemon));

    if (!forward && !reverse) {
      rows.push(normalizePairRows([], selectedPokemon, opponentName));
      continue;
    }

    const directional = [];
    if (forward) directional.push(normalizePerspective([forward], selectedPokemon)[0]);
    if (reverse) directional.push(normalizePerspective([reverse], selectedPokemon)[0]);
    rows.push(normalizePairRows(directional, selectedPokemon, opponentName));
  }

  return rows;
}

function isOhkoOutcome(entry) {
  return entry.tags.includes('OHKO') || entry.tags.some((tag) => /^KILL_TIER_OHKO/.test(tag));
}

function sortMatchups(matchups) {
  const group = (entry) => {
    const ohko = isOhkoOutcome(entry);
    if (entry.result === 1 && ohko) return 0;
    if (entry.result === 1) return 1;
    if (entry.scoreContribution < 0 && ohko) return 4;
    if (entry.scoreContribution < 0) return 3;
    return 2;
  };

  return [...matchups].sort((a, b) => (
    (group(a) - group(b))
    || (b.scoreContribution - a.scoreContribution)
    || a.opponent.localeCompare(b.opponent)
    || ((b.result ?? 0) - (a.result ?? 0))
  ));
}

function buildOutput({ pokemon, rulebook, sortedMatchups, sourcePath, includeLegacyFields = false }) {
  const totalScore = sortedMatchups.reduce((sum, row) => sum + row.scoreContribution, 0);
  const matchups = sortedMatchups.map((row) => {
    if (includeLegacyFields) return row;

    const {
      directionalOutcomeClass,
      directionalOutcomeClassFromAttacker,
      directionalOutcomeClassFromDefender,
      ...withoutLegacy
    } = row;
    return withoutLegacy;
  });

  return {
    selected_pokemon: pokemon,
    applied_rulebook: {
      id: rulebook.id,
      name: rulebook.name,
    },
    source_matchups: sourcePath,
    generated_at: new Date().toISOString(),
    total_score: totalScore,
    matchups,
  };
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function runReturnMatchups(argv = process.argv) {
  const args = parseArgs(argv);

  if (args.command !== 'return-matchups') {
    return false;
  }

  if (!args.matchupsPath || !args.rulebookPath || !args.pokemon || !args.outputPath) {
    throw new Error('Usage: node scripts/return-matchups.js return-matchups --matchups <path> --rulebook <path> --pokemon <name> --output <path> [--trace] [--include-legacy-fields]');
  }

  const matchupsPath = path.resolve(args.matchupsPath);
  const rulebookPath = path.resolve(args.rulebookPath);
  const outputPath = path.resolve(args.outputPath);

  const matchups = loadMatchups(matchupsPath);
  const rulebook = loadRulebook(rulebookPath);
  const ruled = applyRulebook(matchups, rulebook, args.trace);
  const perspective = buildPairwiseRowsForSelectedPokemon(ruled, args.pokemon);
  const sorted = sortMatchups(perspective);
  const payload = buildOutput({
    pokemon: normalizeName(args.pokemon),
    rulebook,
    sortedMatchups: sorted,
    sourcePath: args.matchupsPath,
    includeLegacyFields: args.includeLegacyFields,
  });

  ensureParentDirectory(outputPath);
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote return-matchups file: ${args.outputPath}`);
  return true;
}

if (require.main === module) {
  try {
    const handled = runReturnMatchups(process.argv);
    if (!handled) {
      console.error('Unknown command. Use: return-matchups');
      process.exit(1);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  parseArgs,
  parseTxtMatchups,
  validateMatchupEntry,
  legacyResultToModel,
  loadMatchups,
  loadRulebook,
  applyRulebook,
  normalizePerspective,
  deriveBinaryResult,
  pairKeyUnordered,
  buildPairwiseRowsForSelectedPokemon,
  sortMatchups,
  buildOutput,
  runReturnMatchups,
};
