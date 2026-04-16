#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { Generations, Pokemon, Move, calculate } = require('@smogon/calc');

const gen = Generations.get(9);

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

function toPokemon(set) {
  return new Pokemon(gen, set.species, {
    item: set.item,
    ability: set.ability,
    nature: set.nature,
    evs: set.evs,
    ivs: set.ivs,
    moves: set.moves,
  });
}

function validateSet(set) {
  try {
    return { pokemon: toPokemon(set) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message };
  }
}

function calculateMatchups(sets) {
  const results = [];
  const skipped = [];
  const pokemonCache = new Map();

  for (const set of sets) {
    const validated = validateSet(set);
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

      const moveResults = attackerSet.moves.map((moveName) => {
        const move = new Move(gen, moveName);
        if (move.category === 'Status') {
          return {
            move: moveName,
            desc: 'Status move (no direct damage).',
            damage: { min: 0, max: 0 },
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

        return {
          move: moveName,
          desc: description,
          damage: {
            min: Array.isArray(range) ? range[0] : range,
            max: Array.isArray(range) ? range[1] : range,
          },
        };
      });

      results.push({
        attacker: attackerSet.name,
        defender: defenderSet.name,
        moves: moveResults,
      });
    }
  }

  return { results, skipped };
}

function toText(results) {
  const lines = [];
  for (const result of results) {
    lines.push(`${result.attacker} -> ${result.defender}`);
    for (const move of result.moves) {
      lines.push(`  - ${move.move}: ${move.damage.min}-${move.damage.max}`);
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

  const file = fs.readFileSync(inputPath, 'utf8');
  const sets = parseShowdownSets(file);
  const { results, skipped } = calculateMatchups(sets);

  fs.mkdirSync(path.dirname(outJsonPath), { recursive: true });
  fs.writeFileSync(outJsonPath, JSON.stringify({
    source: inputArg,
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

main();
