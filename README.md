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
  --rulebook rulebooks/standard-rank-matchups-rulebook.json \
  --output matchups/champions_ou_ranked.json
```

## Return matchups for one Pokémon

Use `return-matchups` to load matchup rows, apply a JSON rulebook, normalize everything to one selected Pokémon, and emit a deterministic best-to-worst list with binary outcomes.

```bash
node scripts/return-matchups.js return-matchups \
  --matchups matchups/champions_ou_matchups.json \
  --rulebook rulebooks/default-return-matchups-rulebook.json \
  --pokemon Garchomp \
  --output matchups/garchomp_return_matchups.json \
  --trace
```

### Required flags

- `--matchups <path>`: JSON input (preferred) or TXT via adapter.
- `--rulebook <path>`: JSON rulebook file.
- `--pokemon <name>`: selected Pokémon name.
- `--output <path>`: output file path.

### Matchup JSON schema

Each matchup entry is normalized internally to:

```json
{
  "attacker": "Garchomp",
  "defender": "Corviknight",
  "outcomeClass": "win",
  "scoreContribution": 2,
  "tags": ["OHKO", "SPEED_EDGE"]
}
```

- `attacker`, `defender`: required strings.
- `outcomeClass`: required enum (`win`, `loss`, `draw`, `neutral`).
- `scoreContribution`: required number.
- `tags`: optional string array used by rules.

Legacy `.txt` and legacy JSON `results[]` are parsed through adapters to this schema.

### Rulebook shape

```json
{
  "id": "default_return_v1",
  "name": "Default return-matchups rulebook",
  "rules": [
    {
      "id": "boost-ohko",
      "active": true,
      "match": { "hasTag": "OHKO" },
      "action": { "adjustScore": 1 }
    }
  ]
}
```

Rule actions can:

- `exclude`: remove a matchup row.
- `adjustScore`: numeric delta added before ranking.
- `setOutcomeClass`: override `outcomeClass`.
- `addTags`: append tags.

With `--trace`, output rows include `ruleTrace[]` so you can inspect what rules fired.

Return output rows are intentionally compact:

- `result` is binary (`1` = selected Pokémon wins, `0` = selected Pokémon does not win).
- `calc_output` includes the Smogon-calc-style summary string for both directions so the rulebook can re-evaluate each pair without extra numeric fields.

### Output shape

```json
{
  "selected_pokemon": "Garchomp",
  "applied_rulebook": {
    "id": "default_return_v1",
    "name": "Default return-matchups rulebook"
  },
  "source_matchups": "matchups/champions_ou_matchups.json",
  "generated_at": "2026-01-01T00:00:00.000Z",
  "total_wins": 12,
  "matchups": [
    {
      "pokemon": "Garchomp",
      "opponent": "Corviknight",
      "result": 1,
      "calc_output": {
        "Garchomp_to_Corviknight": "252 Atk Garchomp Earthquake vs. 0 HP / 0 Def Corviknight: ...",
        "Corviknight_to_Garchomp": "252 Atk Corviknight Brave Bird vs. 0 HP / 0 Def Garchomp: ..."
      },
      "directional_outcomes": {
        "from_attacker": "win",
        "from_defender": "loss"
      },
      "ruleTrace": []
    }
  ]
}
```

### GitHub Actions manual dispatch examples

Run the **Rank Pokemon Matchups** workflow from the Actions tab with inputs such as:

- `input_file`: `matchups/champions_ou_matchups.json`
- `rulebook_file`: `rulebooks/standard-rank-matchups-rulebook.json`
- `output_file`: `matchups/champions_ou_ranked.json`
- `commit_and_push`: `true` (or `false` to artifact-only)

When `commit_and_push` is `true`, the workflow stages only the selected `output_file`, commits only if there is a staged diff, and pushes to the current branch (`github.ref_name`).

Run the **Return Matchups For One Pokemon** workflow from the Actions tab with inputs such as:

- `matchups_file`: `matchups/champions_ou_matchups.json`
- `rulebook_file`: `rulebooks/default-return-matchups-rulebook.json`
- `pokemon`: `Garchomp`
- `output_file`: `matchups/garchomp_return_matchups.json`
- `trace`: `false` (set `true` to include `ruleTrace[]`)
- `commit_and_push`: `true` (or `false` to artifact-only)

When `commit_and_push` is `true`, this workflow stages only the selected `output_file`, commits only if there is a staged diff, and pushes to the current branch (`github.ref_name`).

### Rulebooks

Ranking rulebooks now live as editable JSON files under `rulebooks/` and are passed by path (for example `rulebooks/standard-rank-matchups-rulebook.json`).

Included ranking rulebook files:

- `rulebooks/standard-rank-matchups-rulebook.json` (win/tie/loss = 3/1/0)
- `rulebooks/zero-sum-rank-matchups-rulebook.json` (win/tie/loss = 1/0/-1)
- `rulebooks/kill-tier-speed-priority-rank-matchups-rulebook.json` (legacy alias for the standard ruleset)

Each ranking rulebook can include `outcomeRules[]` to define how each head-to-head matchup is resolved before scoring:

- `canOhko`: if only one side can OHKO, it wins; if both can OHKO, faster side wins
- `canGuaranteed2hko`: if neither side settled on OHKO, apply the same logic for guaranteed 2HKO
- `canPossible2hko`: if still unresolved, apply the same logic for potential 2HKO

If no outcome rule settles the matchup, it is a tie.

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
    "description": "Wins/losses are resolved by OHKO, then guaranteed 2HKO, then potential 2HKO (speed breaks equal-threat ties). Scores win=3, tie=1, loss=0.",
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
