# AGENTS.md: @lore/prompts

**Prompts** (#E175): the prompt engine, its triggers and pins, the start of agent jobs and their pages, and the agent hosts they run on. It imports `@lore/core` only, and nothing imports it (`check:conventions`, `scripts/lore-package-graph.ts`). Read the repository's `AGENTS.md` first, then `packages/@lore/core/AGENTS.md`.

## Layout

`src/api` (module `LorePromptsApi`), `src/mcp` (`LorePromptsMcp`), `src/web` (`LorePromptsWeb`, which injects `PromptsRouter` from `register()`), `src/schemas`. Strings live in core's locales, like every package's.

## Core keeps the contract

Plan, Ship and Requirements contribute prompts, and a feature package never imports another, so what they write to stays in core and this package fills it. The seams are listed in `packages/@lore/core/AGENTS.md`, "Prompts: the contract".
