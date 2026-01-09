import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path, { join } from "node:path";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import hljs from "highlight.js";
import { Marked, type Tokens } from "marked";
import type {
  ChangelogChange,
  ChangelogEntry,
  DocItem,
  DocNode,
} from "./interfaces.ts";
import { snippets } from "./snippets.ts";

/**
 * Command for generating documentation tree for the website
 */
export class TreeCommand {
  protected log = $logger();

  /**
   * Languages that should show line numbers
   */
  lineNumberLanguages = new Set([
    "typescript",
    "ts",
    "javascript",
    "js",
    "tsx",
    "jsx",
    "json",
    "css",
    "html",
    "yaml",
    "yml",
    "sql",
    "python",
    "py",
    "go",
    "rust",
    "java",
    "c",
    "cpp",
    "csharp",
    "php",
    "ruby",
    "swift",
    "kotlin",
  ]);

  protected marked = this.createMarked();

  /**
   * Converts npm commands to other package manager equivalents
   */
  convertToPackageManager(
    npmCommand: string,
    target: "npm" | "yarn" | "pnpm" | "bun",
  ): string {
    return npmCommand
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();

        // npx commands → yarn dlx / pnpm dlx / bunx
        if (trimmed.startsWith("npx ")) {
          const rest = trimmed.slice(4);
          switch (target) {
            case "npm":
              return `npx ${rest}`;
            case "yarn":
              return `yarn dlx ${rest}`;
            case "pnpm":
              return `pnpm dlx ${rest}`;
            case "bun":
              return `bunx --bun ${rest}`;
          }
        }

        // npm install with packages
        const installMatch = trimmed.match(/^npm (install|i) (.+)$/);
        if (installMatch) {
          const packages = installMatch[2];
          switch (target) {
            case "npm":
              return `npm install ${packages}`;
            case "yarn":
              return `yarn add ${packages}`;
            case "pnpm":
              return `pnpm add ${packages}`;
            case "bun":
              return `bun add ${packages}`;
          }
        }

        // npm install without packages
        if (trimmed === "npm install" || trimmed === "npm i") {
          switch (target) {
            case "npm":
              return "npm install";
            case "yarn":
              return "yarn";
            case "pnpm":
              return "pnpm install";
            case "bun":
              return "bun install";
          }
        }

        // npm run <script> → yarn/pnpm/bun <script>
        const runMatch = trimmed.match(/^npm run (.+)$/);
        if (runMatch) {
          const script = runMatch[1];
          switch (target) {
            case "npm":
              return `npm run ${script}`;
            case "yarn":
              return `yarn run ${script}`;
            case "pnpm":
              return `pnpm run ${script}`;
            case "bun":
              return `bun run ${script}`;
          }
        }

        return line;
      })
      .join("\n");
  }

  /**
   * Checks if code is a package manager command
   */
  isPackageManagerCommand(code: string): boolean {
    const trimmed = code.trim();
    return /^(npm install|npm i |npm run |npx )/.test(trimmed);
  }

  /**
   * Renders a code block with package manager switcher
   * Selection syncs across all blocks on the page via localStorage
   * The sync logic is handled by HtmlContent.tsx component
   */
  renderPackageManagerBlock(text: string): string {
    const managers = ["npm", "yarn", "pnpm", "bun"] as const;

    // Generate code variants
    const variants = Object.fromEntries(
      managers.map((pm) => [pm, this.convertToPackageManager(text, pm)]),
    );

    // Highlight each variant
    const highlighted = Object.fromEntries(
      managers.map((pm) => [
        pm,
        hljs.highlight(variants[pm], { language: "bash" }).value,
      ]),
    );

    // Encode as base64 for data attributes
    const base64 = Object.fromEntries(
      managers.map((pm) => [pm, Buffer.from(variants[pm]).toString("base64")]),
    );

    // Build data attributes for highlighted HTML
    const htmlAttrs = managers
      .map((pm) => `data-html-${pm}="${this.escapeHtml(highlighted[pm])}"`)
      .join(" ");

    // Build data attributes for copy (base64)
    const codeAttrs = managers
      .map((pm) => `data-code-${pm}="${base64[pm]}"`)
      .join(" ");

    return `
<div class="code-block code-block-pm">
  <div class="code-block-header">
    <div class="pm-tabs">
      ${managers.map((pm, i) => `<button type="button" class="pm-tab${i === 0 ? " pm-tab-active" : ""}" data-pm="${pm}">${pm}</button>`).join("")}
    </div>
    <button class="code-block-copy" data-code="${base64.npm}" ${codeAttrs} onclick="(function(btn){var code=atob(btn.getAttribute('data-code'));navigator.clipboard.writeText(code);btn.textContent='Copied!';setTimeout(function(){btn.textContent='Copy'},2000)})(this)">Copy</button>
  </div>
  <pre><code class="hljs language-bash" ${htmlAttrs} data-code="${base64.npm}">${highlighted.npm}</code></pre>
</div>`.trim();
  }

  /**
   * Escape HTML for use in data attributes
   */
  escapeHtml(html: string): string {
    return html
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /**
   * Parse code block meta info (e.g., ```ts {1,3-5} filename="example.ts")
   */
  parseCodeMeta(meta: string | null | undefined): {
    highlights: Set<number>;
    filename: string | null;
    showLineNumbers: boolean;
    collapsed: boolean;
  } {
    const result = {
      highlights: new Set<number>(),
      filename: null as string | null,
      showLineNumbers: true,
      collapsed: false,
    };

    if (!meta) return result;

    // Parse highlights: {1,3-5,10}
    const highlightMatch = meta.match(/\{([^}]+)\}/);
    if (highlightMatch) {
      const parts = highlightMatch[1].split(",");
      for (const part of parts) {
        if (part.includes("-")) {
          const [start, end] = part.split("-").map(Number);
          for (let i = start; i <= end; i++) {
            result.highlights.add(i);
          }
        } else {
          result.highlights.add(Number(part));
        }
      }
    }

    // Parse filename: filename="example.ts" or title="example.ts"
    const filenameMatch = meta.match(/(?:filename|title)=["']([^"']+)["']/);
    if (filenameMatch) {
      result.filename = filenameMatch[1];
    }

    // Parse showLineNumbers: showLineNumbers=false
    if (meta.includes("showLineNumbers=false") || meta.includes("nolines")) {
      result.showLineNumbers = false;
    }

    // Parse collapsed: collapsed or collapse
    if (meta.includes("collapsed") || meta.includes("collapse")) {
      result.collapsed = true;
    }

    return result;
  }

  /**
   * Render enhanced code block with line numbers and highlighting
   */
  renderEnhancedCodeBlock(
    text: string,
    lang: string,
    meta: string | null | undefined,
  ): string {
    const language = hljs.getLanguage(lang) ? lang : "plaintext";
    const highlighted = hljs.highlight(text, { language }).value;
    const lines = highlighted.split("\n");

    const { highlights, filename, showLineNumbers, collapsed } =
      this.parseCodeMeta(meta);

    // Determine if we should show line numbers
    const shouldShowLineNumbers =
      showLineNumbers && this.lineNumberLanguages.has(lang.toLowerCase());

    // Auto-collapse if more than 25 lines
    const isCollapsible = lines.length > 25 || collapsed;
    const isCollapsed = collapsed && lines.length > 15;

    // Encode raw code as base64
    const base64Code = Buffer.from(text).toString("base64");

    // Build header content
    const headerLeft = filename
      ? `<span class="code-block-filename">${filename}</span>`
      : `<span class="code-block-lang">${lang || "bash"}</span>`;

    const headerRight = `
      ${isCollapsible ? `<button class="code-block-expand" onclick="(function(btn){var block=btn.closest('.code-block');block.classList.toggle('collapsed');btn.textContent=block.classList.contains('collapsed')?'Expand':'Collapse'})(this)">${isCollapsed ? "Expand" : "Collapse"}</button>` : ""}
      <button class="code-block-copy" data-code="${base64Code}" onclick="(function(btn){var code=atob(btn.getAttribute('data-code'));navigator.clipboard.writeText(code);btn.textContent='Copied!';setTimeout(function(){btn.textContent='Copy'},2000)})(this)">Copy</button>
    `.trim();

    // Build code lines
    let codeContent: string;
    if (shouldShowLineNumbers) {
      const lineNumberWidth = String(lines.length).length;
      codeContent = lines
        .map((line, i) => {
          const lineNum = i + 1;
          const isHighlighted = highlights.has(lineNum);
          const highlightClass = isHighlighted ? " code-line-highlighted" : "";
          const lineNumPadded = String(lineNum).padStart(lineNumberWidth, " ");
          return `<span class="code-line${highlightClass}"><span class="code-line-number">${lineNumPadded}</span><span class="code-line-content">${line || " "}</span></span>`;
        })
        .join("");
    } else {
      codeContent = highlighted;
    }

    const collapsedClass = isCollapsed ? " collapsed" : "";
    const lineNumClass = shouldShowLineNumbers ? " has-line-numbers" : "";

    return `
<div class="code-block code-block-enhanced${collapsedClass}${lineNumClass}">
  <div class="code-block-header">
    ${headerLeft}
    <div class="code-block-actions">${headerRight}</div>
  </div>
  <pre><code class="hljs language-${language}">${codeContent}</code></pre>
</div>`.trim();
  }

  /**
   * Gets the last modified date of a file from git history.
   */
  async getGitLastModified(filePath: string): Promise<string | null> {
    this.log.trace(`Getting git last modified for: ${filePath}`);
    try {
      const { exec } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execAsync = promisify(exec);

      const { stdout } = await execAsync(
        `git log -1 --format="%aI" -- "${filePath}"`,
        { cwd: join(import.meta.dirname, "../../..") },
      );

      const date = stdout.trim();
      if (date) {
        this.log.trace(`Last modified: ${date}`);
        return date;
      }
      return null;
    } catch (error) {
      this.log.trace(`Failed to get git last modified: ${error}`);
      return null;
    }
  }

  /**
   * Calculates reading time in minutes based on word count.
   * Average reading speed: 200 words per minute.
   */
  calculateReadingTime(content: string): number {
    const text = content.replace(/<[^>]*>/g, "").replace(/```[\s\S]*?```/g, "");
    const words = text.split(/\s+/).filter((word) => word.length > 0).length;
    const minutes = Math.ceil(words / 200);
    this.log.trace(`Reading time: ${minutes} min (${words} words)`);
    return Math.max(1, minutes);
  }

  /**
   * Extracts keywords from markdown content by parsing headings (h2, h3, h4).
   * Extracts meaningful terms like function names ($atom, $env), class names, etc.
   */
  extractKeywords(content: string): string[] {
    const keywords: Set<string> = new Set();

    // Match markdown headings: ## heading, ### heading, #### heading
    const headingRegex = /^#{2,4}\s+(.+)$/gm;
    const matches = content.matchAll(headingRegex);

    for (const match of matches) {
      const heading = match[1].trim();

      // Extract the raw heading text
      keywords.add(heading);

      // Extract code/function names from backticks: `$atom()` -> $atom
      const codeMatches = heading.matchAll(/`([^`]+)`/g);
      for (const codeMatch of codeMatches) {
        const code = codeMatch[1].replace(/[()]/g, "").trim();
        if (code) {
          keywords.add(code);
        }
      }

      // Extract individual words that look like identifiers (camelCase, PascalCase, $prefixed)
      const words = heading.replace(/`[^`]+`/g, "").split(/\s+/);
      for (const word of words) {
        const cleaned = word.replace(/[():`]/g, "").trim();
        // Include if it looks like an identifier: starts with $, or has mixed case, or is a common term
        if (
          cleaned.startsWith("$") ||
          cleaned.startsWith("use") ||
          /^[A-Z][a-z]/.test(cleaned) ||
          /[a-z][A-Z]/.test(cleaned)
        ) {
          keywords.add(cleaned);
        }
      }
    }

    const result = Array.from(keywords).filter((k) => k.length > 1);
    this.log.trace(`Extracted ${result.length} keywords`);
    return result;
  }

  extractOrder(name: string): number {
    const match = name.match(/^(\d+)-/);
    const order = match
      ? Number.parseInt(match[1], 10)
      : Number.POSITIVE_INFINITY;
    this.log.trace(`Extracted order ${order} from: ${name}`);
    return order;
  }

  cleanName(name: string): string {
    const cleaned = name.replace(/^\d+-/, "");
    this.log.trace(`Cleaned name "${name}" to "${cleaned}"`);
    return cleaned;
  }

  sortByOrder<T extends { name: string }>(items: T[]): T[] {
    this.log.trace(`Sorting ${items.length} items by order`);
    return items.sort((a, b) => {
      const orderA = this.extractOrder(a.name);
      const orderB = this.extractOrder(b.name);

      if (orderA !== orderB) {
        return orderA - orderB;
      }

      return a.name.localeCompare(b.name);
    });
  }

  createMarked() {
    this.log.debug("Creating Marked instance with syntax highlighting");
    const marked = new Marked();

    const renderer = {
      heading: ({ text, depth }: Tokens.Heading) => {
        const slug = text
          .replace(/\//g, "-")
          .replace(/[()`:/@"]/g, "")
          .trim()
          .replace(/ /g, "-")
          .toLowerCase();

        // Escape quotes for HTML attribute (strip backticks for clean data attribute)
        const escapedText = text.replace(/"/g, "&quot;").replace(/`/g, "");

        // Convert inline code (backticks) to <code> tags
        const htmlText = text.replace(/`([^`]+)`/g, "<code>$1</code>");

        // Anchor div for scroll targeting - small negative offset for visual breathing room
        return `
<div id="${slug}" data-depth="${depth}" data-heading="${escapedText}" style="position: relative; top: -16px"></div>
<h${depth} class="doc-heading"><a href="#${slug}" class="heading-anchor">#</a>${htmlText}</h${depth}>`.trim();
      },
      code: ({ text, lang }: Tokens.Code) => {
        // Extract actual language and meta from info string
        // marked's `lang` contains full info string: "typescript filename="x.ts""
        const langParts = (lang || "").split(/\s+/);
        const actualLang = langParts[0] || "";
        const meta = langParts.slice(1).join(" ") || null;

        // Check if this is a package manager command (bash/sh or no lang specified)
        const isBashLike =
          !actualLang || actualLang === "bash" || actualLang === "sh";
        if (isBashLike && this.isPackageManagerCommand(text)) {
          return this.renderPackageManagerBlock(text);
        }

        // Use enhanced block for languages with line numbers
        if (
          actualLang &&
          this.lineNumberLanguages.has(actualLang.toLowerCase())
        ) {
          return this.renderEnhancedCodeBlock(text, actualLang, meta);
        }

        const language = hljs.getLanguage(actualLang || "")
          ? actualLang
          : "plaintext";
        const highlighted = hljs.highlight(text, {
          language: language || "plaintext",
        }).value;

        // Encode raw code as base64 to safely store in data attribute
        const base64Code = Buffer.from(text).toString("base64");

        // Display name for the language
        const langDisplay = actualLang || "bash";

        return `
<div class="code-block">
  <div class="code-block-header">
    <span class="code-block-lang">${langDisplay}</span>
    <button class="code-block-copy" data-code="${base64Code}" onclick="(function(btn){
      var code = atob(btn.getAttribute('data-code'));
      navigator.clipboard.writeText(code);
      btn.textContent = 'Copied!';
      setTimeout(function(){ btn.textContent = 'Copy'; }, 2000);
    })(this)">Copy</button>
  </div>
  <pre><code class="hljs language-${language}">${highlighted}</code></pre>
</div>`.trim();
      },
    };

    marked.use({ renderer });
    marked.use({
      gfm: true,
    });

    this.log.trace("Marked instance created");
    return marked;
  }

  async scanDocsDir(
    dir: string,
    category: string,
    items: DocItem[],
    rootDir: string,
    level: number,
    maxDepth = 3,
  ) {
    if (level > maxDepth) {
      this.log.trace(`Max depth reached at ${dir}`);
      return;
    }

    this.log.debug(`Scanning docs directory: ${dir} (level ${level})`);
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(dir, { withFileTypes: true });
    this.log.trace(`Found ${entries.length} entries in ${dir}`);

    const sortedEntries = this.sortByOrder(
      entries.map((e) => ({ name: e.name, entry: e })),
    ).map((e) => e.entry);

    for (const entry of sortedEntries) {
      const entryPath = join(dir, entry.name);
      const cleanedName = this.cleanName(entry.name);

      if (entry.isDirectory()) {
        // Preserve original name with order prefix in category path
        const newCategory = category ? `${category}/${entry.name}` : entry.name;
        this.log.trace(`Entering directory: ${newCategory}`);
        await this.scanDocsDir(
          entryPath,
          newCategory,
          items,
          rootDir,
          level + 1,
          maxDepth,
        );
      } else if (entry.name.endsWith(".md")) {
        this.log.trace(`Processing markdown file: ${entry.name}`);
        const originalContent = await readFile(entryPath, "utf-8");
        const content = await this.renderContent(originalContent);
        const relativePath = path.relative(rootDir, entryPath);

        const filename = cleanedName.replace(".md", "");
        const categoryPath = category || "root";
        const fullSlug = this.getFullSlug(categoryPath, filename);

        const readingTime = this.calculateReadingTime(originalContent);
        const lastModified = await this.getGitLastModified(entryPath);
        const keywords = this.extractKeywords(originalContent);

        const item = {
          slug: fullSlug,
          name: this.pretty(filename),
          description: "",
          content,
          originalContent,
          originalName: entry.name,
          path: relativePath,
          category: categoryPath,
          order: this.extractOrder(entry.name),
          level,
          readingTime,
          lastModified,
          keywords,
        };
        items.push(item);
        this.log.debug(
          `Added doc item: ${item.slug} (${keywords.length} keywords)`,
        );
      }
    }
  }

  /**
   * Generate full slug including category path
   * Examples:
   * - category: "1-guides", filename: "introduction" → "guides-introduction"
   * - category: "2-concepts", filename: "primitives" → "concepts-primitives"
   * - category: "3-packages/alepha", filename: "api-files" → "packages-alepha-api-files"
   */
  getFullSlug(categoryPath: string, filename: string): string {
    this.log.trace(
      `Generating full slug for category: ${categoryPath}, filename: ${filename}`,
    );

    // Split the category path and clean each part
    const parts = categoryPath.split("/").map((part) => this.cleanName(part));

    // Add the filename
    parts.push(this.cleanName(filename));

    // Join with dashes and create slug
    const fullSlug = this.slug(parts.join("-"));
    this.log.trace(`Generated slug: ${fullSlug}`);

    return fullSlug;
  }

  /**
   * Generate display name for package documentation.
   * Returns just the final part (slug) since the parent directory already provides context.
   * e.g., "Api Files" -> "api-files" (not "@alepha/plugins/api-files")
   */
  getPackageDisplayName(_categoryPath: string, itemName: string): string {
    // Just return the slug of the item name - the directory structure provides context
    return this.slug(itemName);
  }

  buildTree(items: DocItem[]): DocNode[] {
    this.log.debug(`Building navigation tree from ${items.length} items`);
    const tree: DocNode[] = [];
    const categoryMap = new Map<string, DocNode>();

    // Sort items by category depth and order
    const sortedItems = [...items].sort((a, b) => {
      const depthA = a.category.split("/").length;
      const depthB = b.category.split("/").length;
      if (depthA !== depthB) {
        return depthA - depthB;
      }
      return a.order - b.order;
    });

    for (const item of sortedItems) {
      const parts = item.category.split("/");

      // Build nodes for each level of the category path
      for (let i = 0; i < parts.length; i++) {
        const categoryPath = parts.slice(0, i + 1).join("/");
        const categoryName = parts[i];

        if (!categoryMap.has(categoryPath)) {
          // Check if this is inside packages section
          const packagesIndex = parts.findIndex((p) => p.startsWith("3-"));
          const isInsidePackages = packagesIndex !== -1 && i > packagesIndex;

          // Determine display name
          let displayName: string;
          if (isInsidePackages) {
            // Strip order prefix and convert to package name
            // 1-alepha → alepha, 2-@alepha-react → @alepha/react
            const withoutPrefix = categoryName.replace(/^\d+-/, "");
            displayName = withoutPrefix.replace(/^@alepha-/, "@alepha/");
          } else {
            // Use slug format for non-package directories (lowercase, hyphen-separated)
            displayName = this.slug(categoryName);
          }

          const node: DocNode = {
            slug: this.slug(categoryName),
            name: displayName,
            order: this.extractOrder(categoryName),
            children: [],
          };

          if (i === 0) {
            tree.push(node);
            this.log.trace(`Added root node: ${node.name}`);
          } else {
            const parentPath = parts.slice(0, i).join("/");
            const parent = categoryMap.get(parentPath);
            if (parent) {
              parent.children = parent.children || [];
              parent.children.push(node);
              this.log.trace(
                `Added child node: ${node.name} to ${parent.name}`,
              );
            }
          }

          categoryMap.set(categoryPath, node);
        }
      }

      // Add the document as a leaf node
      const parentNode = categoryMap.get(item.category);
      if (parentNode) {
        parentNode.children = parentNode.children || [];

        // Check if this is inside packages section
        const parts = item.category.split("/");
        const packagesIndex = parts.findIndex((p) => p.startsWith("3-"));
        const isInsidePackages = packagesIndex !== -1;

        let displayName: string;
        if (isInsidePackages) {
          // Use original filename to preserve @alepha/ prefix
          // 7-@alepha-bucket-azure.md → @alepha/bucket-azure
          const withoutOrder = item.originalName
            .replace(/^\d+-/, "")
            .replace(/\.md$/, "");
          displayName = withoutOrder.replace(/^@alepha-/, "@alepha/");
        } else {
          // Use slug format for non-package directories (lowercase, hyphen-separated)
          displayName = this.slug(item.name);
        }

        parentNode.children.push({
          slug: item.slug,
          name: displayName,
          order: item.order,
          href: `/docs/${item.slug}`,
          description: item.description,
          keywords: item.keywords,
        });
        this.log.trace(`Added doc leaf: ${displayName}`);
      }
    }

    // Sort all children by order
    const sortChildren = (nodes: DocNode[]) => {
      nodes.sort((a, b) => {
        if (a.order !== b.order) {
          return a.order - b.order;
        }
        return a.name.localeCompare(b.name);
      });

      for (const node of nodes) {
        if (node.children) {
          sortChildren(node.children);
        }
      }
    };

    sortChildren(tree);
    this.log.debug(`Built tree with ${tree.length} root nodes`);

    return tree;
  }

  slug(name: string) {
    const slug = name
      .toLowerCase()
      .replace(/(\d+)-/, "") // remove leading numbers
      .replace(/[/\\]/g, "-")
      .replace(/\s+/g, "-") // replace spaces with dashes
      .replace("@", "");
    this.log.trace(`Generated slug "${slug}" from "${name}"`);
    return slug;
  }

  pretty(name: string) {
    const pretty = name
      .replace(/(\d+)-/, "")
      .replace(/[-/\\]/g, " ")
      .replace("@", "")
      .split(" ")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
    this.log.trace(`Prettified "${name}" to "${pretty}"`);
    return pretty;
  }

  renderContent(content: string) {
    this.log.trace(`Rendering ${content.length} chars of markdown`);
    return this.marked.parse(content);
  }

  /**
   * Parse CHANGELOG.md and extract structured changelog entries
   */
  parseChangelog(content: string): ChangelogEntry[] {
    this.log.debug("Parsing CHANGELOG.md");
    const entries: ChangelogEntry[] = [];

    // Split by version headers: ## [0.14.3] - 2026-01-08
    const versionRegex = /^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})/gm;
    const sections = content.split(versionRegex);

    // sections[0] is content before first version (if any)
    // Then triplets: [version, date, content]
    for (let i = 1; i < sections.length; i += 3) {
      const version = sections[i];
      const date = sections[i + 1];
      const sectionContent = sections[i + 2] || "";

      const features: ChangelogChange[] = [];
      const fixes: ChangelogChange[] = [];

      // Parse Features section
      const featuresMatch = sectionContent.match(
        /### Features\s*\n([\s\S]*?)(?=### |$)/,
      );
      if (featuresMatch) {
        const featureLines = featuresMatch[1].trim().split("\n");
        for (const line of featureLines) {
          const change = this.parseChangelogLine(line);
          if (change) features.push(change);
        }
      }

      // Parse Bug Fixes section
      const fixesMatch = sectionContent.match(
        /### Bug Fixes\s*\n([\s\S]*?)(?=### |$)/,
      );
      if (fixesMatch) {
        const fixLines = fixesMatch[1].trim().split("\n");
        for (const line of fixLines) {
          const change = this.parseChangelogLine(line);
          if (change) fixes.push(change);
        }
      }

      if (features.length > 0 || fixes.length > 0) {
        entries.push({ version, date, features, fixes });
        this.log.trace(
          `Parsed version ${version}: ${features.length} features, ${fixes.length} fixes`,
        );
      }
    }

    this.log.debug(`Parsed ${entries.length} changelog entries`);
    return entries;
  }

  /**
   * Parse a single changelog line like:
   * - **cli**: add openapi extractor (`5e87f93e`)
   */
  parseChangelogLine(line: string): ChangelogChange | null {
    // Match: - **scope**: message (`commit`)
    const match = line.match(
      /^- \*\*([^*]+)\*\*:\s*(.+?)(?:\s*\(`([^`]+)`\))?$/,
    );
    if (!match) return null;

    return {
      scope: match[1].trim(),
      message: match[2].trim(),
      commit: match[3]?.trim(),
    };
  }

  tree = $command({
    name: "gen:tree",
    description: "Generate documentation for the website",
    handler: async ({ run }) => {
      this.log.debug("Starting website documentation generation");
      const rootDir = join(import.meta.dirname, "../../..");
      const outputDir = join(import.meta.dirname, "../.gen");
      const docsDir = join(rootDir, "docs");

      this.log.debug(`Root directory: ${rootDir}`);
      this.log.debug(`Output directory: ${outputDir}`);
      this.log.debug(`Docs directory: ${docsDir}`);

      await run("clean output", async () => {
        await rm(outputDir, { force: true, recursive: true });
        this.log.trace("Removed old output directory");
        await mkdir(outputDir, { recursive: true });
        this.log.trace("Created fresh output directory");
      });

      const items: DocItem[] = [];

      await run("parse docs", async () => {
        await this.scanDocsDir(docsDir, "", items, rootDir, 0);
        this.log.debug(`Parsed ${items.length} docs from /docs`);
      });

      await run("write output", async () => {
        const TAG = "%TBRM%";
        const result: Array<any> = [];

        for (const item of items) {
          this.log.trace(`Writing doc: ${item.slug}`);
          const content = item.content
            .replaceAll("`", "\\`")
            .replaceAll("${", "\\${")
            .replaceAll("\t", "  ");

          const filename = `${item.slug}.ts`;
          await writeFile(
            path.join(outputDir, filename),
            `export default \`${content}\``,
          );

          const category = item.category.split("/")[0];
          await writeFile(
            path.join(outputDir, `${category}-${item.originalName}`),
            item.originalContent,
          );

          result.push({
            slug: item.slug,
            name: item.name,
            description: item.description,
            path: item.path,
            category: item.category,
            order: item.order,
            level: item.level,
            readingTime: item.readingTime,
            lastModified: item.lastModified,
            keywords: item.keywords,
            content: `${TAG}() => import('./${filename}').then(it => it.default)${TAG}`,
          });
        }
        this.log.debug(`Wrote ${result.length} doc files`);

        const renderedSnippets: Record<string, string> = {};
        for (const key of Object.keys(snippets) as Array<
          keyof typeof snippets
        >) {
          this.log.trace(`Rendering snippet: ${key}`);
          renderedSnippets[key] = (await this.renderContent(
            `\`\`\`tsx filename="${snippets[key].filename}"\n${snippets[key].content.trim()}\n\`\`\``,
          )) as string;
        }

        const treeData = this.buildTree(items);
        this.log.debug("Built navigation tree");

        // Parse changelog
        const changelogPath = join(rootDir, "CHANGELOG.md");
        const changelogContent = await readFile(changelogPath, "utf-8");
        const changelog = this.parseChangelog(changelogContent);
        this.log.debug(`Parsed ${changelog.length} changelog entries`);

        // Custom JSON replacer to handle POSITIVE_INFINITY
        const jsonReplacer = (_key: string, value: any) => {
          if (value === Number.POSITIVE_INFINITY) {
            return 9999;
          }
          return value;
        };

        const outputFilepath = join(outputDir, "index.ts");
        const outputFileContent = `
				export const docs = ${JSON.stringify(result, jsonReplacer, 2)};
				export const tree = ${JSON.stringify(treeData, jsonReplacer, 2)};
				export const snippets = ${JSON.stringify(renderedSnippets, null, 2)};
				export const changelog = ${JSON.stringify(changelog, null, 2)};
				`
          .trim()
          .replace(new RegExp(`"?${TAG}"?`, "g"), "");

        await writeFile(outputFilepath, outputFileContent);

        this.log.debug(`Wrote index file: ${outputFilepath}`);
      });

      this.log.debug("Website documentation generation complete");
    },
  });
}
