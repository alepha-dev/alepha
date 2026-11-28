# useAiChatFloatDrag

## Import

```typescript
import { useAiChatFloatDrag } from "@alepha/ui/ai";
```

## Overview

Moves the floating assistant by its header, the way a chat
window is dragged: a pointer pressed on the header, not on one of its
buttons, carries the card, which never leaves the screen.

The offset lives as long as the `AiChat` holding it, so a minimize or a
close keeps where the card was put; a reload, a resize of the window or a
double click on the header brings it back to its corner. A keyboard user
never moves it, and keeps the corner.
