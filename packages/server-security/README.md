# Alepha Server Security

Add security layer to the Alepha server.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/server-security
```
## Module

Real (or fake) user account, used for internal actions.
		
		If you define this, you assume that all actions are executed by this user by default.
		> To force a different user, you need to pass it explicitly in the options.
