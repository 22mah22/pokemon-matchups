# pokemon-matchups

Repo with tools to scan pokemon matchups.

## Quick start

```bash
npm install
npm run matchups:test1
npm run matchups:test2
```

This reads Showdown import sets from `libraries/*.txt` and writes matchup outputs to `matchups/*_matchups.json` and `matchups/*_matchups.txt`.

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
