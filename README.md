<h1 align="center">council-axi</h1>

<p align="center">Multi-LLM adversarial review council - an <a href="https://github.com/kunchenguid/axi">AXI</a>.</p>

---

`council-axi` sends a single prompt to several independent LLM judges and returns a synthesized review. It is useful when you want more than one model to look at a plan, decision, or code change before you act. Output is in [TOON](https://toonformat.dev/) so agents can read it cheaply.

It is provider-agnostic. If a provider speaks the OpenAI chat completions API, you can add it to your council by setting a few environment variables.

## Install

```sh
npm install -g council-axi
```

Or run without installing:

```sh
npx -y council-axi <command>
```

## Configure providers

Pick a short key for each provider, then set `COUNCIL_PROVIDERS` plus per-provider env vars.

For example, with OpenAI and Groq:

```sh
export COUNCIL_PROVIDERS="openai,groq"

export OPENAI_API_KEY="sk-..."
export OPENAI_BASE_URL="https://api.openai.com/v1"
export OPENAI_MODEL="gpt-4o"
export OPENAI_DISPLAY_NAME="OpenAI"

export GROQ_API_KEY="gsk_..."
export GROQ_BASE_URL="https://api.groq.com/openai/v1"
export GROQ_MODEL="llama-3.1-70b-versatile"
export GROQ_DISPLAY_NAME="Groq"
```

Required for each provider:

- `<KEY>_API_KEY` - the provider API key
- `<KEY>_BASE_URL` - the OpenAI-compatible base URL
- `<KEY>_MODEL` - the model ID to call

Optional:

- `<KEY>_DISPLAY_NAME` - human-readable name shown in output (defaults to the key)

### Example providers

These are not built in. Add the ones you have keys for.

**OpenAI**

```sh
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o
```

**Moonshot Kimi**

```sh
KIMI_API_KEY=sk-...
KIMI_BASE_URL=https://api.moonshot.ai/v1
KIMI_MODEL=kimi-k3
```

**DeepSeek**

```sh
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
```

**Xiaomi MiMo**

```sh
MIMO_API_KEY=sk-...
MIMO_BASE_URL=https://api.xiaomimimo.com/v1
MIMO_MODEL=mimo-v2.5-pro
```

**Groq**

```sh
GROQ_API_KEY=gsk_...
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_MODEL=llama-3.1-70b-versatile
```

**Local LM Studio / Ollama / vLLM**

Anything with an OpenAI-compatible endpoint works:

```sh
LOCAL_API_KEY=not-needed
LOCAL_BASE_URL=http://localhost:1234/v1
LOCAL_MODEL=local-model
```

## Usage

Check which providers are authenticated:

```sh
$ council-axi setup
providers[2]{name,authenticated,detail}:
  openai,true,OpenAI API key is set
  groq,true,Groq API key is set
help[2]:
  Set COUNCIL_PROVIDERS and per-provider env vars to add judges
  Example: COUNCIL_PROVIDERS=openai OPENAI_API_KEY=sk-... OPENAI_BASE_URL=https://api.openai.com/v1 OPENAI_MODEL=gpt-4o
```

Run an adversarial review:

```sh
$ council-axi review "Should we add a caching layer here?"
```

Or pick a subset:

```sh
$ council-axi review "Should we add a caching layer here?" --models openai,groq
```

Pressure-test a plan:

```sh
$ council-axi plan "Should we migrate auth to a separate service?"
```

Attach files, a directory, or a diff:

```sh
$ council-axi review "is this sound?" --file plan.md --file src/
$ council-axi review "what did I break?" --diff
$ git diff | council-axi review "check this" --stdin
```

Example output:

```
council[review]: "Should we add a caching layer here?"
judges: 2 of 2 responded
judges[2]{provider,model,status,verdict}:
  openai,gpt-4o,success,Ship after adding cache invalidation
  groq,llama-3.1-70b-versatile,success,Ship but measure hit ratio first
synthesis:
  ## Council review synthesis (2 judges)

  ### openai (gpt-4o)
  Ship after adding cache invalidation.

  ### groq (llama-3.1-70b-versatile)
  Ship but measure hit ratio first.

  **Key points:**
  - Ship after adding cache invalidation
  - Ship but measure hit ratio first
help[1]: Run `npx -y council-axi review "<prompt>" --models openai,groq`
```

## Attaching artifacts

```sh
council-axi review "is this sound?" --file plan.md --file src/
council-axi review "what did I break?" --diff            # git diff HEAD
council-axi review "review this range" --diff HEAD~3
git diff | council-axi review "check this" --stdin
```

Files and directories are embedded in the prompt with path labels (remote
judges have no filesystem access). Directories respect `.gitignore` files at
or below the attached path (a repo-root `.gitignore` above the attached
directory is not consulted); `node_modules`/`.git` are always skipped; binary
files are skipped with a
warning. The combined artifact budget defaults to 400 KB - explicit `--file`
inputs first, then the diff, then directory expansions; anything past the cap
is truncated or omitted and named in the output's `warnings` section. Override
with `COUNCIL_MAX_ARTIFACT_BYTES`.

## Exit codes

- `0` - at least one judge responded
- `1` - runtime error or no providers available
- `2` - unknown flag or argument

## Agent integration

`council-axi` ships with an installable Agent Skill in `skills/council-axi/SKILL.md`. Copy it into your agent's skill directory, or point your agent at the CLI directly:

```sh
npx -y council-axi review "..." --models openai,groq
```

## Harness hooks

`council-axi hook <event>` is a portable lifecycle entrypoint any agent
harness can call. It reads the harness's JSON payload from stdin (or
`--payload '<json>'`), best-effort, and never hard-fails on unknown shapes.

- `council-axi hook session-start` - prints available providers and usage as
  context. Always exits 0.
- `council-axi hook post-edit` - records edited file paths for the session.
  Always exits 0. Harnesses must wait for this command's exit before firing
  `stop`.
- `council-axi hook stop` - review gate. If edits are pending, the council
  reviews `git diff HEAD` for those paths. Majority-fail verdict blocks with
  exit 2 and the synthesis on stdout. Anything else exits 0; provider outages
  fail open (edits kept for manual re-review).

Claude Code / openclaude wiring (`~/.claude/settings.json`):

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "council-axi hook session-start" }] }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write|MultiEdit",
        "hooks": [{ "type": "command", "command": "council-axi hook post-edit" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "council-axi hook stop" }] }
    ]
  }
}
```

Other harnesses (pi, opencode, codex, Gemini CLI, goose): point their
session-start / after-edit / stop lifecycle events at the same three commands.
What a harness does with hook stdout and exit codes varies - consult its docs.
Payload formats are parsed best-effort; if your harness's shape is not
recognized, the hooks degrade gracefully (session tracking falls back to a
cwd-based key with a stderr warning).

## Development

```sh
npm install
npm test          # vitest
npm run build     # tsc -> dist
npm run dev -- review "..." --models openai
```

## License

[MIT](LICENSE)
