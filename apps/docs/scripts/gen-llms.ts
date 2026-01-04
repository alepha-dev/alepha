import { promises as fs } from "node:fs";
import path, { join } from "node:path";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";

/**
 * Command for generating llms.txt file from documentation
 */
export class LlmsCommand {
  protected log = $logger();

  llms = $command({
    name: "gen:llms",
    description: "Generate llms.txt file from documentation",
    handler: async ({ run }) => {
      this.log.debug("Starting llms.txt generation");
      const docsDir = join(import.meta.dirname, "../node_modules/.docs");
      const outputDir = join(import.meta.dirname, "../dist/public");
      const outputFile = join(outputDir, "llms.txt");

      this.log.debug(`Docs directory: ${docsDir}`);
      this.log.debug(`Output file: ${outputFile}`);

      await run("scan markdown files", async () => {
        // Check if docs directory exists
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
          .sort(); // Sort for consistent order
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

      await run("write llms.txt", async () => {
        // Create output directory if it doesn't exist
        await fs.mkdir(outputDir, { recursive: true });
        this.log.trace(`Created/verified output directory: ${outputDir}`);

        // Write the concatenated content
        await fs.writeFile(outputFile, concatenatedContent, "utf-8");
        this.log.debug(
          `Wrote ${concatenatedContent.length} chars to ${outputFile}`,
        );
      });

      this.log.debug(`Successfully created: ${outputFile}`);
      this.log.debug(
        `Total content length: ${concatenatedContent.length} characters`,
      );
      this.log.debug(`Files processed: ${markdownFiles.length}`);
    },
  });
}
