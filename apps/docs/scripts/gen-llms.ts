import { promises as fs } from "node:fs";
import path, { join } from "node:path";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import type { DocNode } from "./interfaces.ts";

/**
 * Command for generating llms.txt and llms-full.txt files from documentation
 */
export class LlmsCommand {
  protected log = $logger();

  llms = $command({
    name: "gen:llms",
    description: "Generate llms.txt index and llms-full.txt from documentation",
    handler: async ({ run }) => {
      this.log.debug("Starting llms generation");
      const docsDir = join(import.meta.dirname, "../node_modules/.docs");
      const outputDir = join(import.meta.dirname, "../dist/public");
      const outputFileFull = join(outputDir, "llms-full.txt");
      const outputFileIndex = join(outputDir, "llms.txt");

      this.log.debug(`Docs directory: ${docsDir}`);
      this.log.debug(`Output files: ${outputFileIndex}, ${outputFileFull}`);

      await run("scan markdown files", async () => {
        try {
          await fs.access(docsDir);
          this.log.trace("Docs directory exists");
        } catch {
          this.log.error(`Docs directory not found: ${docsDir}`);
          throw new Error(`Docs directory not found: ${docsDir}`);
        }
      });

      let markdownFiles: string[] = [];

      await run("find markdown files", async () => {
        const files = await fs.readdir(docsDir);
        markdownFiles = files
          .filter((file) => file.endsWith(".md"))
          .map((file) => join(docsDir, file))
          .sort();
        this.log.debug(`Found ${markdownFiles.length} markdown files`);
      });

      let concatenatedContent = "";

      await run("concatenate markdown files", async () => {
        for (const file of markdownFiles) {
          this.log.trace(`Reading file: ${file}`);
          const content = await fs.readFile(file, "utf-8");
          const fileName = path.basename(file);
          concatenatedContent += `# ${fileName}\n\n${content}\n\n---\n\n`;
          this.log.trace(`Added ${content.length} chars from ${fileName}`);
        }
        this.log.debug(
          `Total concatenated content: ${concatenatedContent.length} chars`,
        );
      });

      let indexContent = "";

      await run("generate index", async () => {
        const indexModule = await import("../.gen/index.ts");
        const tree = indexModule.tree as DocNode[];
        indexContent = this.generateIndex(tree);
        this.log.debug(`Generated index: ${indexContent.length} chars`);
      });

      await run("write files", async () => {
        await fs.mkdir(outputDir, { recursive: true });
        this.log.trace(`Created/verified output directory: ${outputDir}`);

        await fs.writeFile(outputFileFull, concatenatedContent, "utf-8");
        this.log.debug(
          `Wrote ${concatenatedContent.length} chars to ${outputFileFull}`,
        );

        await fs.writeFile(outputFileIndex, indexContent, "utf-8");
        this.log.debug(
          `Wrote ${indexContent.length} chars to ${outputFileIndex}`,
        );
      });

      this.log.debug(
        `Successfully created: ${outputFileIndex}, ${outputFileFull}`,
      );
      this.log.debug(`Full docs: ${concatenatedContent.length} characters`);
      this.log.debug(`Index: ${indexContent.length} characters`);
      this.log.debug(`Files processed: ${markdownFiles.length}`);
    },
  });

  protected generateIndex(tree: DocNode[]): string {
    const lines: string[] = [];

    lines.push(`# Alepha

> Alepha is a convention-driven TypeScript framework for building robust, end-to-end type-safe full-stack applications.

## Overview

**Core Principles:**
- **Primitive Architecture**: Define features using \`$\`-prefixed primitives (\`$action\`, \`$entity\`, \`$page\`) that auto-register with the framework
- **Zero-Mapping**: No route files, no config files - code structure IS the configuration
- **End-to-End Type Safety**: Types flow from database schema → API → React components
- **Convention over Configuration**: Sensible defaults, minimal boilerplate

**Built on**: Drizzle (ORM), React (SSR), Vite (bundler), TypeBox (validation)
**Runs on**: Node.js 22+, Bun, Cloudflare Workers, Vercel, Docker

**Quick Start**: \`npx alepha init\` - Creates minimal config files to use Alepha in current directory

## Examples

### API + Database
\`\`\`typescript
import { t } from "alepha";
import { $action } from "alepha/server";
import { $entity, $repository, db } from "alepha/orm";

const userEntity = $entity({
  name: "users",
  schema: t.object({
    id: db.primaryKey(),
    email: t.email(),
    createdAt: db.createdAt(),
  }),
});

class UserController {
  repo = $repository(userEntity);

  getUser = $action({
    path: "/users/:id",  // → GET /api/users/:id
    schema: {
      params: t.object({ id: t.uuid() }),
      response: userEntity.schema,
    },
    handler: async ({ params }) => this.repo.findById(params.id),
  });
}
\`\`\`

### React Page with SSR
\`\`\`typescript
import { $page } from "@alepha/react/router";
import { $client } from "alepha/server/links";
import type { UserController } from "./UserController.ts";

class AppRouter {
  api = $client<UserController>(); // infer API client from controller

  users = $page({
    path: "/users",
    resolve: async () => ({ users: await this.api.listUsers() }),
    component: ({ users }) => (
      <ul>
        {users.map(u => <li key={u.id}>{u.email}</li>)}
      </ul>
    ),
  });
}
\`\`\`

## Conventions

- \`$action\` paths auto-prefix with \`/api\`
- Method: GET default, POST if body schema exists
- Response schema strips undeclared fields (security)
- \`t.\` = TypeBox via \`import { t } from "alepha"\`
- Primitives are class properties, not standalone (except \`$atom\`, \`$entity\`)

## Quick Reference

Core utilities:

- \`t\` (TypeBox schemas) - \`import { t } from "alepha"\`
- \`db\` (database column helpers) - \`import { db } from "alepha/orm"\`

Core primitives:

- \`$inject\` - \`import { $inject } from "alepha"\`
- \`$env\` - \`import { $env } from "alepha"\`
- \`$module\` - \`import { $module } from "alepha"\`
- \`$atom\` - \`import { $atom } from "alepha"\`
- \`$logger\` - \`import { $logger } from "alepha/logger"\`
- \`$action\` - \`import { $action } from "alepha/server"\`
- \`$entity\` - \`import { $entity } from "alepha/orm"\`
- \`$repository\` - \`import { $repository } from "alepha/orm"\`
- \`$page\` - \`import { $page } from "@alepha/react/router"\`
- \`$queue\` - \`import { $queue } from "alepha/queue"\`
- \`$scheduler\` - \`import { $scheduler } from "alepha/scheduler"\`
- \`$cache\` - \`import { $cache } from "alepha/cache"\`
- \`$bucket\` - \`import { $bucket } from "alepha/bucket"\`
- \`$realm\` - \`import { $realm } from "alepha/security"\`
- \`$command\` - \`import { $command } from "alepha/command"\`

React hooks:

- \`useStore\` - \`import { useStore } from "@alepha/react"\`
- \`useClient\` - \`import { useClient } from "@alepha/react"\`
- \`useRouter\` - \`import { useRouter } from "@alepha/react/router"\`
- \`useForm\` - \`import { useForm } from "@alepha/react/form"\`

## Docs

- [Full Docs](https://alepha.dev/llms-full.txt): Complete documentation of Alepha with all details.
- [Examples](https://github.com/feunard/alepha/tree/main/apps): Example applications
`);

    for (const node of tree) {
      this.renderNode(node, lines, 0);
    }

    return lines.join("\n");
  }

  protected renderNode(
    node: DocNode,
    lines: string[],
    depth: number,
    parentName?: string,
  ): void {
    // Skip asset nodes (like llms.txt itself)
    if (node.asset) {
      return;
    }

    if (node.children && node.children.length > 0) {
      // Only render heading for top-level categories (depth 0)
      if (depth === 0) {
        const title = this.formatTitle(node.name);
        lines.push(`## ${title}`);
        lines.push("");
      }

      // Pass current node name as parent for nested categories (depth > 0)
      // Skip "Alepha" as parent since it's redundant in the Packages section
      const formattedName = this.formatTitle(node.name);
      const nextParent =
        depth > 0 && formattedName !== "Alepha" ? formattedName : undefined;

      for (const child of node.children) {
        this.renderNode(child, lines, depth + 1, nextParent);
      }

      if (depth === 0) {
        lines.push("");
      }
    } else if (node.href) {
      // Leaf node - render as list item
      const title = this.formatTitle(node.name);
      const displayTitle = parentName ? `${parentName} - ${title}` : title;
      const url = `https://alepha.dev${node.href}`;
      const description = node.description ? `: ${node.description}` : "";
      lines.push(`- [${displayTitle}](${url})${description}`);
    }
  }

  protected formatTitle(name: string): string {
    return name
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }
}
