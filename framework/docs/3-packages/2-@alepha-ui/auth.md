# @alepha/ui - Auth

## Installation

```bash
npm install @alepha/ui
```

## Overview

Sign-in, registration and recovery screens.

`AuthRouter` mounts the whole flow; `AuthLogin`, `AuthRegister`,
`AuthResetPassword`, `AuthVerifyEmail` and `AuthMfaStep` are its pages, for an
app that lays them out itself. `TurnstileWidget` is the captcha they share.

## API Reference

### React Hooks

- [`usePasskey`](/docs/reference-react-hooks-usepasskey) - Passkeys from React: add one, remove one, prove with one, sign in with
