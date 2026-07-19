---
description: Run a multi-LLM adversarial review of an artifact or question
argument-hint: '<prompt> [--models <providers>]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run an adversarial review through the council-axi CLI.

Raw arguments: `$ARGUMENTS`

Run:
```bash
node /home/rufi/projects/council-axi/dist/cli.js review "$ARGUMENTS"
```

Return stdout verbatim.
