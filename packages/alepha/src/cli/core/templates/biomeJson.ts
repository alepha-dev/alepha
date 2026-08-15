export const biomeJson = () =>
  `
{
  "$schema": "https://biomejs.dev/schemas/latest/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git"
  },
  "files": {
    "ignoreUnknown": true,
    "includes": ["**", "!node_modules", "!dist", "!public"]
  },
  "formatter": {
    "enabled": true,
    "useEditorconfig": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "preset": "recommended",
      "a11y": {
        "useFocusableInteractive": "off",
        "useSemanticElements": "off",
        "useKeyWithClickEvents": "off",
        "useAriaPropsForRole": "off",
        "noLabelWithoutControl": "off"
      },
      "correctness": {
        "useExhaustiveDependencies": "off"
      },
      "suspicious": {
        "noArrayIndexKey": "off",
        "noExplicitAny": "off",
        "noDocumentCookie": "off"
      },
      "style": {
        "noNonNullAssertion": "off"
      }
    },
    "domains": {
      "react": "recommended"
    }
  },
  "css": {
    "parser": {
      "cssModules": false,
      "tailwindDirectives": true
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
`.trim() + "\n";
