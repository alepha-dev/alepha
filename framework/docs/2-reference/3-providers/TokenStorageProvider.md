# TokenStorageProvider

## Import

```typescript
import { TokenStorageProvider } from "@alepha/capacitor/core";
```

## Overview

Where a native app keeps its session tokens.

The web implementation (this class) keeps nothing: a website's session
lives in cookies the server sets, and `ReactAuth` keeps using them. The
native one is the platform's secure store (iOS Keychain, Android Keystore)
through `@aparajita/capacitor-secure-storage`.
