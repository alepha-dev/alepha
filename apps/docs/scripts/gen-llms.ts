import { promises as fs } from "node:fs";
import path, { join } from "node:path";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import type { DocNode } from "./interfaces.ts";

interface DocItem {
  slug: string;
  path: string;
}

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
      const docsDir = join(import.meta.dirname, "../.gen");
      const publicDir = join(import.meta.dirname, "../public");
      const outputDir = join(import.meta.dirname, "../dist/public");
      const llmsIndexFile = join(publicDir, "llms-index.md");
      const outputFileFull = join(outputDir, "llms-full.txt");
      const outputFileIndex = join(outputDir, "llms.txt");

      this.log.debug(`Docs directory: ${docsDir}`);
      this.log.debug(`Public directory: ${publicDir}`);
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
      let baseContent = "";

      await run("read llms-index.md", async () => {
        try {
          baseContent = await fs.readFile(llmsIndexFile, "utf-8");
          this.log.debug(`Read llms-index.md: ${baseContent.length} chars`);
        } catch {
          this.log.warn(
            `llms-index.md not found at ${llmsIndexFile}, using empty base`,
          );
        }
      });

      await run("generate index", async () => {
        // Generate doc tree links
        const indexModule = await import("../.gen/index.ts");
        const tree = indexModule.tree as DocNode[];
        const docLinks = this.generateDocLinks(tree);

        // Combine base content with generated doc links
        indexContent = `${baseContent}\n${docLinks}`;
        this.log.debug(`Generated index: ${indexContent.length} chars`);
      });

      await run("write files", async () => {
        await fs.mkdir(outputDir, { recursive: true });
        this.log.trace(`Created/verified output directory: ${outputDir}`);

        const fullContent = `${baseContent}\n\n---\n\n${concatenatedContent}`;
        await fs.writeFile(outputFileFull, fullContent, "utf-8");
        this.log.debug(
          `Wrote ${fullContent.length} chars to ${outputFileFull}`,
        );

        await fs.writeFile(outputFileIndex, indexContent, "utf-8");
        this.log.debug(
          `Wrote ${indexContent.length} chars to ${outputFileIndex}`,
        );
      });

      await run("copy markdown files to dist", async () => {
        // Import docs metadata to get slug → path mapping
        const indexModule = await import("../.gen/index.ts");
        const docs = indexModule.docs as DocItem[];
        const rootDir = join(import.meta.dirname, "../../..");
        const docsOutputDir = join(outputDir, "docs");

        await fs.mkdir(docsOutputDir, { recursive: true });
        this.log.trace(`Created docs output directory: ${docsOutputDir}`);

        let copiedCount = 0;
        for (const doc of docs) {
          const sourcePath = join(rootDir, doc.path);
          const destPath = join(docsOutputDir, `${doc.slug}.md`);

          try {
            const content = await fs.readFile(sourcePath, "utf-8");
            await fs.writeFile(destPath, content, "utf-8");
            copiedCount++;
            this.log.trace(`Copied: ${doc.slug}.md`);
          } catch (error) {
            this.log.warn(`Failed to copy ${doc.slug}: ${error}`);
          }
        }

        this.log.debug(
          `Copied ${copiedCount} markdown files to ${docsOutputDir}`,
        );
      });

      this.log.debug(
        `Successfully created: ${outputFileIndex}, ${outputFileFull}`,
      );
      this.log.debug(
        `Full docs: ${baseContent.length + concatenatedContent.length} characters`,
      );
      this.log.debug(`Index: ${indexContent.length} characters`);
      this.log.debug(`Files processed: ${markdownFiles.length}`);
    },
  });

  protected generateDocLinks(tree: DocNode[]): string {
    const lines: string[] = [];

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
      // Leaf node - render as list item with .md extension for markdown files
      const title = this.formatTitle(node.name);
      const displayTitle = parentName ? `${parentName} - ${title}` : title;
      const url = `https://alepha.dev${node.href}.md`;
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
