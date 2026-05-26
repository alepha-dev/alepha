# MockContainerProvider

## Import

```typescript
import { MockContainerProvider } from "alepha/containers";
```

## Overview

In-process test provider.

Resolves the action name against `LinkProvider`'s registered links in
the SAME Alepha instance — effectively calling the "containerized"
controller as if it were local. Use it in tests: register the
controller class on the test container alongside the consumer and
substitute `ContainerProvider` with `MockContainerProvider`.

