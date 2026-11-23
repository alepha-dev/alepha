# @alepha/ui - Markdown

## Installation

```bash
npm install @alepha/ui
```

## Overview

Markdown rendered as prose, with diagrams.

`MarkdownView` renders GitHub-flavoured markdown with highlighted code, and
draws `flowchart` and `sequenceDiagram` fences as SVG. `highlightLines`
highlights a whole file line by line with the same grammars, for a code
view that numbers its lines. `diagramKind`,
`parseFlowchart` and `parseSequence` expose the parsers, so an editor can
validate a diagram before it is saved.

Imports its own stylesheet, so it is loaded through a bundler rather than
plain Node.
