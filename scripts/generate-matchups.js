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
  return text
    .trim()
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
      const header = lines[0];
      const [namePart, itemPart] = header.split('@').map((part) => part.trim());
      const set = {
        name: namePart,
        item: itemPart || undefined,
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
  return new Pokemon(gen, set.name, {
    item: set.item,
    ability: set.ability,
    nature: set.nature,
    evs: set.evs,
    ivs: set.ivs,
    moves: set.moves,
  });
}

function calculateMatchups(sets) {
  const results = [];

  for (let i = 0; i < sets.length; i += 1) {
    for (let j = 0; j < sets.length; j += 1) {
      if (i === j) continue;
      const attackerSet = sets[i];
      const defenderSet = sets[j];
      const attacker = toPokemon(attackerSet);
      const defender = toPokemon(defenderSet);

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

  return results;
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
  const results = calculateMatchups(sets);

  fs.mkdirSync(path.dirname(outJsonPath), { recursive: true });
  fs.writeFileSync(outJsonPath, JSON.stringify({ source: inputArg, count: results.length, results }, null, 2));
  fs.writeFileSync(outTxtPath, toText(results));

  console.log(`Generated:\n- ${outJsonPath}\n- ${outTxtPath}`);
}

main();
