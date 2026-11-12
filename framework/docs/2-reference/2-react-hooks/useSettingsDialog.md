# useSettingsDialog

## Import

```typescript
import { useSettingsDialog } from "@alepha/ui/settings";
```

## Overview

A settings dialog's state and the way to open and close it.

```tsx
const account = useSettingsDialog("account");
if (account.sections.length === 0) return null;
return <Button onClick={() => account.open("sessions")}>Sessions</Button>;
```
