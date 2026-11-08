# Alepha - Cli Mcp

## Installation

Part of the `alepha` package. Import from `alepha/cli/mcp`.

```bash
npm install alepha
```

## Overview

`alepha mcp`: an MCP server on stdio for the coding agent working on an
app. It finds the apps `alepha dev` runs through the inspector's run
registry, and exposes their map, logs, captured emails and SMS, database
rows, jobs and actions as tools, along with the installed docs.

A module of its own, registered by the `alepha` binary only, rather than a
command of `alepha/cli`: it reaches the inspector, and through it the ORM,
which a tool that bundles the `alepha/cli` services must not carry.
