# pokemon-matchups

Repo with tools to scan pokemon matchups.

## Quick start

```bash
npm install
npm run matchups:test1
npm run matchups:test2
```

This reads Showdown import sets from `libraries/*.txt` (with optional enrichment from companion `libraries/*.json`) and writes matchup outputs to `matchups/*_matchups.json` and `matchups/*_matchups.txt`.

## File layout

- `libraries/test_set_1.txt`
- `libraries/test_set_1.json`
- `libraries/test_set_2.txt`
- `libraries/test_set_2.json`
- `scripts/generate-matchups.js`
- `matchups/test_set_1_matchups.json`
- `matchups/test_set_1_matchups.txt`
- `matchups/test_set_2_matchups.json`
- `matchups/test_set_2_matchups.txt`

## Output format

Each `results[]` entry in `matchups/*_matchups.json` is an attacker-vs-defender evaluation with these key fields:

- `attacker`, `defender`
- `attackerSpeed`, `defenderSpeed`, `speedTie`
- `bestKillTier`
- `hasDamagingPriorityMove`: `true` when at least one move has `priority > 0` and does direct damage in that matchup (`damage.max > 0`)
- `moves[]`: per-move breakdown (`move`, `priority`, `damage`, `desc`, and KO tier/flag fields)

`priority` is populated from Smogon Calc for valid damaging moves, and is `null` for status or invalid-move fallback entries.

Rulebook consumers should apply tie-break criteria in this order when all higher criteria are equal: kill tier, speed edge, then `hasDamagingPriorityMove`.

## GitHub Actions job

Run the **Generate Pokemon Matchups** workflow from the Actions tab and provide a library file path (for example `libraries/champions_ou.txt`).

The workflow runs `scripts/generate-matchups.js` against that library and always writes outputs to:

- `matchups/<library>_matchups.json`
- `matchups/<library>_matchups.txt`

These files are replaced on subsequent runs for the same library base name.

By default, the workflow only uploads the generated files as artifacts. If you set the `commit_and_push` workflow input to `true`, the job also:

- configures a GitHub Actions bot git user,
- stages `matchups/<library>_matchups.txt` and `matchups/<library>_matchups.json`,
- creates commit `Update <library> matchups` only when staged files changed,
- pushes the commit to the workflow branch (branch protection rules still apply).

## Ranking job input design

Ranking is handled by `scripts/rank-matchups.js` and now treats **JSON as the primary input format**.

```bash
node scripts/rank-matchups.js --input matchups/champions_ou_matchups.json --rulebook kill-tier-speed-priority-v1
```

### Supported input

- Recommended: `matchups/*.json` (precomputed matchup results)
- Recommended: `libraries/*.json` (set library that can be expanded into matchup results)
- Optional: `*.txt` inputs, such as `libraries/*.txt`

TXT is accepted for compatibility, but ranking quality may depend on whether a companion JSON file exists for enrichment (`<same-name>.json`). For best ranking accuracy/reliability, prefer JSON inputs.

### CLI contract

- Required: `--input <path>`
- Required: `--rulebook <id>`
- Current rulebook IDs: `kill-tier-speed-priority-v1`

The script validates rulebook IDs up front and fails fast when no normalized matchup records can be produced.

### Normalized in-memory schema

Each directional record used by ranking is normalized to:

- `pokemon`: `{ id, name }`
- `opponent`: `{ id, name }`
- `result`: `win | lose | tie`
- `metadata`: includes `rulebookId`, kill-tier rank data, speed advantage, and priority flags used by rulebook evaluation
