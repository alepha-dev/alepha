# @alepha/ui - Ai

## Installation

```bash
npm install @alepha/ui
```

## Overview

The in-app assistant on the client: a chat drawer with streamed replies,
history and a confirmation card per mutation, the headless `useAiChat`,
and `useAiContext` for a page to declare what it shows. Talks to
`alepha/api/ai`.

## API Reference

### React Hooks

- [`useAiChat`](/docs/reference-react-hooks-useaichat) - The state and actions of an assistant conversation, without any UI: what
- [`useAiContext`](/docs/reference-react-hooks-useaicontext) - Declare what the current page shows the assistant: a short `page` name,
