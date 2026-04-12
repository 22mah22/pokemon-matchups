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
