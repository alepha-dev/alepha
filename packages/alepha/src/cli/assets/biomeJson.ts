export const biomeJson = () => `
{
  "$schema": "https://biomejs.dev/schemas/latest/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git"
  },
  "files": {
    "ignoreUnknown": true,
    "includes": ["**", "!node_modules", "!dist"]
  },
  "formatter": {
    "enabled": true,
    "useEditorconfig": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    },
    "domains": {
      "react": "recommended"
    }
  },
  "assist": {
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  }
}
`.trim();
