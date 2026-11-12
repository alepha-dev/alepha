# @alepha/ui - Account

## Installation

```bash
npm install @alepha/ui
```

## Overview

The signed-in user's own account, as a settings dialog over the page.

`AccountDialog` declares the `account` dialog and its five sections
(profile, security, sessions, API keys, connected apps), each its own lazy
chunk fetching its own data. The section components are exported by name
too. An application adds a section with `$settingsSection` against
`AccountDialog.dialog`.

The profile page ends with `AccountDisplay`, the viewer's own display
settings: the colour-blind switch, which a signed-in viewer finds here and
not in the account menu.
