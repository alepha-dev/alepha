# Installation

The Alepha CLI is bundled inside the `alepha` package. No separate installation required.

## Getting Started

Create a new project:

```bash
npx alepha init
```

This initializes your project and adds `alepha` as a dependency. From then on, run commands from your project directory:

```bash
npx alepha dev
npx alepha build
```

## Why Not Global Install?

Global installation (`npm install -g alepha`) is not recommended. When working on multiple projects, each may require a different Alepha version. Using `npx` or project-local scripts ensures each project uses its own version.

## Using npm Scripts

After `alepha init`, your `package.json` includes ready-to-use scripts:

```json
{
  "scripts": {
    "dev": "alepha dev",
    "build": "alepha build",
    "verify": "alepha verify"
  }
}
```

Run them with your package manager:

```bash
npm run dev
yarn dev
pnpm dev
```

## Requirements

- **Node.js 22+** — Alepha uses modern JavaScript features

Check your version:

```bash
node --version
```
