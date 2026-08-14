# Installation

The Alepha CLI is bundled inside the `alepha` package. No separate installation required.

## Getting Started

Create a new project:

```bash
npx alepha init my-app
```

This scaffolds a full-stack project — API, React web module, and Tailwind — and adds `alepha` as a dependency.

Building something that needs accounts? Add `--preset=saas` and you also get sign-in, an account area and an admin console, wired and running on first boot. See [init](./2-commands/1-init.md#the-saas-preset).

From then on, run commands from your project directory:

```bash
npx alepha dev
npx alepha build
```

Lost? Run `npx alepha -h` to see every command at your disposal. It's the cheat sheet you didn't know you needed.

## Why Not Global Install?

Global installation (`npm install -g alepha`) is not recommended. When working on multiple projects, each may require a different Alepha version. Using `npx` or project-local scripts ensures each project uses its own version.

## Using npm Scripts

After `alepha init`, your `package.json` includes ready-to-use scripts:

```json
{
  "scripts": {
    "dev": "alepha dev",
    "build": "alepha build",
    "test": "alepha test",
    "lint": "alepha lint",
    "typecheck": "alepha typecheck",
    "verify": "alepha verify"
  }
}
```

Run them with your package manager:

```bash
npm run dev
```

## Requirements

- **Node.js 22+** — Alepha uses modern JavaScript features

Check your version:

```bash
node --version
```
