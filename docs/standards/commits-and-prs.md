# Commits and pull requests

How branches, commits and PRs are written:

- **Commit, push and merge** only when the user asks.
- **Branches** are `feat/…`, `fix/…`, `docs/…`, `ci/…` or `chore/…`.
- **Hooks** (`lefthook.yml`) format and lint the staged files before each commit, and run the
  format, type and lint checks before each push. Fix what they report; never skip them with
  `--no-verify`.
- **Commits** follow Conventional Commits, `type(scope): imperative subject`, with the part of the
  game as the scope (`git log --oneline` shows the ones in use). The body gives the why and any
  measured numbers.
- **PR bodies** fill in `.github/pull_request_template.md`: Description (the context, the why,
  and what changes for the player or the developer), Proposed changes (the most important ones
  when the list is long), How to test and Preview. How to test gives numbered manual steps only,
  since CI runs the automated checks: how to playtest a gameplay change, or the commands and
  output that show a tools or DX change works. The body asks the user nothing: every question
  and open point is settled with the user before the PR opens, so the body states only what was
  decided. Add `Closes #N`. A visible change carries
  before/after screenshots or a playtest video in Preview
  (`gh pr create --attach 'shot.png#alt text'`).
- **Big changes** (a map part, a subsystem) get a review before the PR, through separate lenses
  (pipeline correctness, data fidelity, tests and docs, runtime and render), with a skeptic
  re-checking each finding before it is fixed.
