#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { Generations, Pokemon, Move, calculate } = require('@smogon/calc');

const gen = Generations.get(9);
const DEFAULT_BATTLE_LEVEL = 50;
const KILL_TIERS = {
  OHKO_GUARANTEED: 'OHKO_GUARANTEED',
  OHKO_POSSIBLE: 'OHKO_POSSIBLE',
  HKO2_GUARANTEED: 'HKO2_GUARANTEED',
  HKO2_POSSIBLE: 'HKO2_POSSIBLE',
  WORSE: 'WORSE',
};

function parseStatLine(line, prefix) {
  const raw = line.slice(prefix.length).trim();
  const parts = raw.split('/').map((chunk) => chunk.trim());
  const stats = {};

  for (const part of parts) {
    const match = part.match(/^(\d+)\s+(HP|Atk|Def|SpA|SpD|Spe)$/i);
    if (!match) continue;
    const [, value, stat] = match;
    const key = {
      HP: 'hp',
      Atk: 'atk',
      Def: 'def',
      SpA: 'spa',
      SpD: 'spd',
      Spe: 'spe',
    }[stat];
    stats[key] = Number(value);
  }

  return stats;
}

function parseShowdownSets(text) {
  const parseHeader = (headerLine) => {
    const [namePart, itemPart] = headerLine.split('@').map((part) => part.trim());
    const withoutGender = namePart.replace(/\s+\((M|F)\)$/i, '').trim();
    const nicknameSpeciesMatch = withoutGender.match(/^(.*?)\s+\(([^()]+)\)$/);
    const species = nicknameSpeciesMatch ? nicknameSpeciesMatch[2].trim() : withoutGender;

    return {
      name: withoutGender,
      species,
      item: itemPart || undefined,
    };
  };

  return text
    .trim()
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
      const header = lines[0];
      const parsedHeader = parseHeader(header);
      const set = {
        name: parsedHeader.name,
        species: parsedHeader.species,
        item: parsedHeader.item,
        ability: undefined,
        nature: undefined,
        evs: {},
        ivs: {},
        moves: [],
      };

      for (const line of lines.slice(1)) {
        if (line.startsWith('Ability:')) {
          set.ability = line.replace('Ability:', '').trim();
        } else if (line.startsWith('EVs:')) {
          set.evs = parseStatLine(line, 'EVs:');
        } else if (line.startsWith('IVs:')) {
          set.ivs = parseStatLine(line, 'IVs:');
        } else if (line.endsWith('Nature')) {
          set.nature = line.replace('Nature', '').trim();
        } else if (line.startsWith('- ')) {
          set.moves.push(line.replace('- ', '').trim());
        }
      }

      return set;
    });
}

function hasDetailedSetData(set) {
  return Boolean(
    set.item
    || set.ability
    || set.nature
    || set.moves.length > 0
    || Object.keys(set.evs).length > 0
    || Object.keys(set.ivs).length > 0
  );
}

function parseLibrarySets(inputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext !== '.txt') {
    throw new Error(
      `Unsupported input extension "${ext || '(none)'}". Only detailed Showdown set libraries in .txt format are supported.`
    );
  }

  const file = fs.readFileSync(inputPath, 'utf8');
  return parseShowdownSets(file);
}

function toPokemon(set, battleLevel = DEFAULT_BATTLE_LEVEL) {
  const normalizeTextField = (value) => (
    typeof value === 'string' && value.trim().toLowerCase() === 'none'
      ? undefined
      : value
  );

  return new Pokemon(gen, set.species, {
    level: battleLevel,
    item: normalizeTextField(set.item),
    ability: normalizeTextField(set.ability),
    nature: normalizeTextField(set.nature),
    evs: set.evs,
    ivs: set.ivs,
    moves: set.moves,
  });
}

function validateSet(set, battleLevel = DEFAULT_BATTLE_LEVEL) {
  try {
    return { pokemon: toPokemon(set, battleLevel) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message };
  }
}

function deriveKillFlags(damage, defenderHp) {
  const minDamage = Math.max(0, Number(damage?.min) || 0);
  const maxDamage = Math.max(0, Number(damage?.max) || 0);
  const hp = Math.max(1, Number(defenderHp) || 1);

  const ohkoGuaranteed = minDamage >= hp;
  const ohkoPossible = maxDamage >= hp;
  const hko2Guaranteed = minDamage * 2 >= hp;
  const hko2Possible = maxDamage * 2 >= hp;

  return {
    ohkoGuaranteed,
    ohkoPossible,
    hko2Guaranteed,
    hko2Possible,
  };
}

function tierFromFlags(flags) {
  if (flags.ohkoGuaranteed) return KILL_TIERS.OHKO_GUARANTEED;
  if (flags.ohkoPossible) return KILL_TIERS.OHKO_POSSIBLE;
  if (flags.hko2Guaranteed) return KILL_TIERS.HKO2_GUARANTEED;
  if (flags.hko2Possible) return KILL_TIERS.HKO2_POSSIBLE;
  return KILL_TIERS.WORSE;
}

function bestKillTierForMoves(moves) {
  const order = [
    KILL_TIERS.OHKO_GUARANTEED,
    KILL_TIERS.OHKO_POSSIBLE,
    KILL_TIERS.HKO2_GUARANTEED,
    KILL_TIERS.HKO2_POSSIBLE,
    KILL_TIERS.WORSE,
  ];
  const rank = new Map(order.map((tier, index) => [tier, index]));
  return moves.reduce((best, move) => (
    rank.get(move.killTier) < rank.get(best) ? move.killTier : best
  ), KILL_TIERS.WORSE);
}

function hasDamagingPriorityMove(moves) {
  return moves.some((move) => (move.priority ?? 0) > 0 && (move.damage?.max ?? 0) > 0);
}

function compareResultsByRulebook(a, b) {
  const order = [
    KILL_TIERS.OHKO_GUARANTEED,
    KILL_TIERS.OHKO_POSSIBLE,
    KILL_TIERS.HKO2_GUARANTEED,
    KILL_TIERS.HKO2_POSSIBLE,
    KILL_TIERS.WORSE,
  ];
  const rank = new Map(order.map((tier, index) => [tier, index]));

  const tierDiff = rank.get(a.bestKillTier) - rank.get(b.bestKillTier);
  if (tierDiff !== 0) return tierDiff;

  const aSpeedAdvantage = a.attackerSpeed - a.defenderSpeed;
  const bSpeedAdvantage = b.attackerSpeed - b.defenderSpeed;
  if (aSpeedAdvantage !== bSpeedAdvantage) {
    return bSpeedAdvantage - aSpeedAdvantage;
  }

  const aPriorityEdge = a.hasDamagingPriorityMove ? 1 : 0;
  const bPriorityEdge = b.hasDamagingPriorityMove ? 1 : 0;
  if (aPriorityEdge !== bPriorityEdge) {
    return bPriorityEdge - aPriorityEdge;
  }

  return a.attacker.localeCompare(b.attacker);
}

function calculateMatchups(sets, options = {}) {
  const battleLevel = Number.isFinite(Number(options.battleLevel))
    ? Number(options.battleLevel)
    : DEFAULT_BATTLE_LEVEL;
  const results = [];
  const skipped = [];
  const pokemonCache = new Map();

  for (const set of sets) {
    const validated = validateSet(set, battleLevel);
    if (validated.error) {
      skipped.push({ name: set.name, species: set.species, reason: validated.error });
      continue;
    }
    pokemonCache.set(set.name, validated.pokemon);
  }

  const validSets = sets.filter((set) => pokemonCache.has(set.name));

  for (let i = 0; i < validSets.length; i += 1) {
    for (let j = 0; j < validSets.length; j += 1) {
      if (i === j) continue;
      const attackerSet = validSets[i];
      const defenderSet = validSets[j];
      const attacker = pokemonCache.get(attackerSet.name);
      const defender = pokemonCache.get(defenderSet.name);
      const attackerSpeed = attacker?.stats?.spe ?? attacker?.rawStats?.spe ?? 0;
      const defenderSpeed = defender?.stats?.spe ?? defender?.rawStats?.spe ?? 0;
      const defenderHp = defender?.stats?.hp ?? defender?.rawStats?.hp ?? 1;

      const moveResults = attackerSet.moves.map((moveName) => {
        let move;
        try {
          move = new Move(gen, moveName);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const damage = { min: 0, max: 0 };
          const killFlags = deriveKillFlags(damage, defenderHp);
          return {
            move: moveName,
            priority: null,
            desc: `Invalid move: ${message}`,
            damage,
            ...killFlags,
            killTier: tierFromFlags(killFlags),
          };
        }
        if (move.category === 'Status') {
          const damage = { min: 0, max: 0 };
          const killFlags = deriveKillFlags(damage, defenderHp);
          return {
            move: moveName,
            priority: null,
            desc: 'Status move (no direct damage).',
            damage,
            ...killFlags,
            killTier: tierFromFlags(killFlags),
          };
        }

        const result = calculate(gen, attacker, defender, move);
        const range = result.range();
        let description = '';
        try {
          description = result.desc();
        } catch (error) {
          description = 'No direct damage (likely immunity).';
        }

        const damage = {
          min: Array.isArray(range) ? range[0] : range,
          max: Array.isArray(range) ? range[1] : range,
        };
        const killFlags = deriveKillFlags(damage, defenderHp);

        return {
          move: moveName,
          priority: move.priority,
          desc: description,
          damage,
          ...killFlags,
          killTier: tierFromFlags(killFlags),
        };
      });

      const matchupResult = {
        attacker: attackerSet.name,
        defender: defenderSet.name,
        attackerSpeed,
        defenderSpeed,
        speedTie: attackerSpeed === defenderSpeed,
        bestKillTier: bestKillTierForMoves(moveResults),
        hasDamagingPriorityMove: hasDamagingPriorityMove(moveResults),
        moves: moveResults,
      };

      results.push(matchupResult);
    }
  }

  return { results, skipped, battleLevel };
}

function toText(results) {
  const lines = [];
  const sortedResults = [...results].sort(compareResultsByRulebook);
  for (const result of sortedResults) {
    lines.push(`${result.attacker} -> ${result.defender}`);
    lines.push(`  Speed: ${result.attackerSpeed} vs ${result.defenderSpeed}${result.speedTie ? ' (tie)' : ''}`);
    lines.push(`  Has damaging priority move: ${result.hasDamagingPriorityMove}`);
    for (const move of result.moves) {
      const priorityLabel = move.priority == null ? '' : ` [prio ${move.priority}]`;
      lines.push(`  - ${move.move}${priorityLabel}: ${move.damage.min}-${move.damage.max}`);
      lines.push(`    ${move.desc}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}

function main() {
  const inputArg = process.argv[2];
  if (!inputArg) {
    console.error('Usage: node scripts/generate-matchups.js <path-to-library-txt>');
    process.exit(1);
  }

  const inputPath = path.resolve(inputArg);
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const outJsonPath = path.resolve('matchups', `${baseName}_matchups.json`);
  const outTxtPath = path.resolve('matchups', `${baseName}_matchups.txt`);

  const sets = parseLibrarySets(inputPath);
  const { results, skipped, battleLevel } = calculateMatchups(sets);

  fs.mkdirSync(path.dirname(outJsonPath), { recursive: true });
  fs.writeFileSync(outJsonPath, JSON.stringify({
    source: inputArg,
    battleLevel,
    count: results.length,
    skippedCount: skipped.length,
    skipped,
    results,
  }, null, 2));
  fs.writeFileSync(outTxtPath, toText(results));

  if (skipped.length > 0) {
    console.warn(`Skipped ${skipped.length} invalid set(s).`);
  }
  console.log(`Generated:\n- ${outJsonPath}\n- ${outTxtPath}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  KILL_TIERS,
  parseShowdownSets,
  parseLibrarySets,
  calculateMatchups,
  compareResultsByRulebook,
  DEFAULT_BATTLE_LEVEL,
};
