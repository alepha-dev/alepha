# Introduction

Lore is an open-source project management app built on Alepha.

Projects hold **quests** (the roadmap and the in-flight work), **folios** (project
memory, wiki-linked and optionally end-to-end encrypted), **feedback** (inbound bug
and feature triage) and **blights** (deduplicated crash telemetry reported by
enrolled apps).

Every one of those surfaces is exposed over **MCP**, which is the primary consumer:
an AI agent reads the folio index to orient itself, drives quests as work lands, and
files what it learned back as a folio.

## Why it exists

Lore is the only public Alepha application, and it lives in the framework's own
repository on purpose. It is where framework changes get used before they are
recommended: a rough edge in Alepha shows up in Lore first, and the fix ships in the
same commit as the feature that exposed it.

## Status

Lore is deployed at [lore.alepha.dev](https://lore.alepha.dev) and shares its version
number with the rest of the ecosystem. There is no self-host artifact yet.
