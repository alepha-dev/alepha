# GitHubSecretStore

## Import

```typescript
import { GitHubSecretStore } from "alepha/cli/platform-lib";
```

## Overview

GitHub Actions secret store backed by the `gh` CLI.

Requires the GitHub CLI (`gh`) to be installed and authenticated.
Pushes secrets into GitHub Actions environments.
