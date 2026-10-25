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
- **PR bodies**: a feature PR has What, Data (map changes), How, Testing, Known limits and
  Screenshots; a small one has Summary and Testing. Testing lists each command run with its
  result, then what was not run and why. Add `Closes #N`. A visible change carries before/after
  screenshots (`gh pr create --attach 'shot.png#alt text'`).
- **Big changes** (a map part, a subsystem) get a review before the PR, through separate lenses
  (pipeline correctness, data fidelity, tests and docs, runtime and render), with a skeptic
  re-checking each finding before it is fixed.
- **PR-Agent** (`.github/workflows/pr-agent.yml`) reviews each PR with Claude when it opens,
  leaves draft, or receives a new commit, and posts code suggestions; it leaves the PR body
  alone. The required check `PR-Agent review` fails only when the review is blocking (it
  requests changes, or flags a security concern). A collaborator's `/review`, `/improve` or
  `/ask …` comment runs it again, and is the only way to review a fork's PR, since GitHub
  withholds the API key from fork runs.
