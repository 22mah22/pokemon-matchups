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
Ranking is handled by `scripts/rank-matchups.js`.

### Manual ranking via CLI

```bash
node scripts/rank-matchups.js \
  --input matchups/champions_ou_matchups.json \
  --rulebook standard_v1 \
  --output matchups/champions_ou_ranked.json
```

### GitHub Actions manual dispatch examples

Run the **Rank Pokemon Matchups** workflow from the Actions tab with inputs such as:

- `input_file`: `matchups/champions_ou_matchups.json`
- `rulebook`: `standard_v1`
- `output_file`: `matchups/champions_ou_ranked.json`
- `commit_and_push`: `true` (or `false` to artifact-only)

When `commit_and_push` is `true`, the workflow stages only the selected `output_file`, commits only if there is a staged diff, and pushes to the current branch (`github.ref_name`).

### Rulebooks

Current rulebook IDs:

- `standard_v1` (win/tie/loss = 3/1/0)
- `zero_sum_v1` (win/tie/loss = 1/0/-1)
- `kill-tier-speed-priority-v1` (legacy alias of `standard_v1` scoring)

### Ranked output shape

The ranking output JSON contains:

- `rulebook`: object with `id`, `description`, and `scoring`
- `generatedAt`: ISO timestamp
- `input`: original input path
- `totals`: summary counts
- `stats[]`: per-Pokémon stats (`pokemon`, `wins`, `losses`, `ties`, `score`, `total`, `winRate`)
- `ranking[]`: final ordered ranking entries (`rank`, `pokemon`, `score`)

Example shape:

```json
{
  "rulebook": {
    "id": "standard_v1",
    "description": "Scores each normalized result as win=3, tie=1, loss=0.",
    "scoring": { "win": 3, "tie": 1, "loss": 0 }
  },
  "generatedAt": "2026-01-01T00:00:00.000Z",
  "input": "matchups/champions_ou_matchups.json",
  "totals": {
    "normalizedCount": 0,
    "pokemonCount": 0
  },
  "stats": [
    {
      "pokemon": "Examplemon",
      "wins": 12,
      "losses": 5,
      "ties": 1,
      "score": 37,
      "total": 18,
      "winRate": 0.7058823529
    }
  ],
  "ranking": [
    { "rank": 1, "pokemon": "Examplemon", "score": 37 }
  ]
}
```
