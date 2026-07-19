# Contributing

Thanks for wanting to contribute.

**Human-authored pull requests targeting `main` must be raised through [`no-mistakes`](https://github.com/kunchenguid/no-mistakes).**

`no-mistakes` puts a local git proxy in front of your real remote.
Pushing through it runs an AI-driven review/test/build pipeline in an isolated worktree, forwards the push to the configured target only after every check passes, and opens a clean PR automatically.
Fork-based contributions require no-mistakes **v1.30.1** or newer.

A GitHub Actions check (`Require no-mistakes`) runs on PRs targeting `main` and fails if the body is missing the deterministic signature that no-mistakes writes.
The release and dependency bots are exempt so their automation keeps working, but regular contributor PRs without the signature will not be reviewed or merged.

## Workflow

1. Fork the repo, then clone the parent repo or set your local `origin` back to the parent repo (`git@github.com:lanjak/council-axi.git`).
2. Create a branch and make your changes.
3. Initialize or refresh the gate with your fork as the push target: `no-mistakes init --fork-url git@github.com:<you>/council-axi.git`.
4. Commit your changes.
5. Push through the gate instead of pushing to `origin`:

   ```sh
   git push no-mistakes
   ```

6. Run `no-mistakes` to attach to the pipeline, watch findings, and auto-fix or review as needed.
7. Once the pipeline passes, it pushes your branch to your fork and opens the PR against this repo for you.

See the [no-mistakes quick start](https://kunchenguid.github.io/no-mistakes/start-here/quick-start/) for the full first-run walkthrough.

## Repo conventions

- Use Node 20+.
- Run the same checks that CI runs before pushing:

  ```sh
  npm install
  npm run build
  npm test
  npm run lint
  ```

- Use conventional commit messages (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`) if you want your change to appear in release notes.
- Do not commit `dist/`, `node_modules/`, or `.pi/`.
- Keep source files focused; one clear responsibility per file.
- All output must follow AXI conventions: TOON on stdout, structured errors, contextual help lines, and exit codes `0`/`1`/`2`.

## Questions

Open an issue.
