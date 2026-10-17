# CLAUDE.md — ServGo Смена

@AGENTS.md

## Code review

Review rules for this repository are in [REVIEW.md](REVIEW.md).

This repository intentionally has no GitHub Actions (see AGENTS.md, rule 9), so review runs locally before a PR is opened:

1. Run `npm run check`.
2. Run `/code-review` and `/security-review`, or ask a fresh-context subagent to review the diff against REVIEW.md.
3. Fix findings, or note in the PR why a finding is a false positive.

If the same finding keeps coming back, fix the cause in REVIEW.md, AGENTS.md or a test instead of re-running the review.
