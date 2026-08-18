# Installation

The Alepha CLI is bundled inside the `alepha` package. No separate installation required.

## Getting Started

Create a new project:

```bash
npm create alepha my-app
```

`create-alepha` is the standalone starter built for this job — `yarn create`, `pnpm create` and `bun create` all work, and each picks its own package manager. It runs an interactive wizard for anything you don't pass on the command line. Already inside a project (or want to fill in missing pieces)? `npx alepha init` does the same scaffolding in place, and takes `--force` to overwrite.

Either way, this scaffolds a full-stack project — API, React web module, and Tailwind — and adds `alepha` as a dependency.

Building something that needs accounts? Add `--preset=saas` and you also get sign-in, an account area and an admin console, wired and running on first boot. See [init](/docs/cli-commands-init#the-saas-preset).

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
- or **Bun 1.3+**, if Bun is your runtime

Check your version:

```bash
node --version
```
