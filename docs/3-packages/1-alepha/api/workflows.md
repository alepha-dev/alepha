# Alepha - Api Workflows

## Installation

Part of the `alepha` package. Import from `alepha/api/workflows`.

```bash
npm install alepha
```

## Overview

Durable workflow engine for long-running business processes.

**Features:**
- Declarative, multi-step workflows with typed payloads
- Saga-pattern compensation for failure recovery
- Per-step retry with exponential backoff
- Workflow-level timeout and cancellation
- Deduplication via unique keys
- Per-execution log capture

