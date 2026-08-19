import { $inject } from "alepha";
import { FileSystemProvider } from "alepha/system";

/**
 * A fenced code block, located precisely enough to report on.
 */
export interface DocFence {
  /** Language tag, e.g. `ts`, `typescript`, `tsx`, `bash`. */
  lang: string;

  /** Whether the fence opted in to compilation with the `check` marker. */
  checked: boolean;

  /** 1-based line of the opening fence. */
  line: number;

  /** Fence body, including its trailing newline. */
  code: string;
}

export interface DocViolation {
  file: string;

  /** 1-based line. */
  line: number;

  message: string;
}

/**
 * A checked fence, resolved to the file and line it came from so a compiler
 * error can be reported against the markdown rather than the temp file.
 */
export interface DocUnit {
  file: string;
  line: number;
  code: string;

  /** Fence language, so a `tsx` block keeps its extension on disk. */
  lang: string;
}

/**
 * Symbols and phrases the docs must not use, with the reason.
 *
 * This list is the cheap half of `check:docs`. It exists because the docs
 * spent months instructing every AI that read them to
 * `import { t } from "alepha"` — an export deleted in the Zod migration —
 * and nothing in the pipeline noticed. Matching is whole-word, so
 * `toTypeBoxSchema` (an internal devtools identifier) and the English word
 * "the" do not trip it.
 */
export const BANNED_DOC_SYMBOLS: Array<{ pattern: string; reason: string }> = [
  {
    pattern: "TypeBox",
    reason: "typebox is not a dependency; the schema layer is Zod 4",
  },
  {
    pattern: "typebox",
    reason: "typebox is not a dependency; the schema layer is Zod 4",
  },
  {
    pattern: "t\\.object",
    reason: "`t` is not exported from `alepha` — use `z.object`",
  },
  {
    pattern: "pg\\.createdAt",
    reason: "`pg` is not exported from `alepha/orm` — use `db.createdAt`",
  },
  {
    pattern: "pg\\.updatedAt",
    reason: "`pg` is not exported from `alepha/orm` — use `db.updatedAt`",
  },
  {
    pattern: "pg\\.deletedAt",
    reason: "`pg` is not exported from `alepha/orm` — use `db.deletedAt`",
  },
  {
    pattern: 'import \\{ t \\} from "alepha"',
    reason: "`t` is not exported from `alepha` — use `z`",
  },
  // --- symbols removed or renamed before v1; every entry below was found ---
  // --- stale in the docs during the 2026-07 pre-v1 audit                 ---
  {
    pattern: "\\$use",
    reason: "`$use` was renamed — the atom-injection primitive is `$store`",
  },
  {
    pattern: "\\$transaction",
    reason:
      "`$transaction` does not exist — use the `$transactional` middleware in `use: [...]`",
  },
  {
    pattern: "alepha deploy",
    reason:
      "there is no top-level `alepha deploy` command — use `alepha p up` / `alepha p deploy`, or the target CLI (wrangler/vercel/surge) directly",
  },
  {
    pattern: "SERVER_API_PREFIX",
    reason:
      "no code reads `SERVER_API_PREFIX` — the /api prefix is the `serverApiOptions` atom",
  },
  {
    pattern: "mcpSseOptions",
    reason: "deprecated alias — use `mcpStreamableHttpOptions`",
  },
  {
    pattern: "SseMcpTransport",
    reason: "deprecated alias — use `StreamableHttpMcpTransport`",
  },
  {
    pattern: "\\.schema\\(\\)",
    reason:
      "actions expose no `schema()` method — schemas are served over the `_links` route",
  },
  {
    pattern: "AlephaCliPlatform",
    reason:
      "`AlephaCliPlatform` does not exist — use the `platform({...})` helper in `plugins: [...]` (module: `AlephaCliPlatformPlugin`)",
  },
  {
    pattern: "AlephaCliVendor",
    reason:
      "`AlephaCliVendor` does not exist — use the `vendor({...})` helper in `plugins: [...]` (module: `AlephaCliVendorPlugin`)",
  },
  {
    pattern: "page\\.data",
    reason: "paginate results carry `content`, not `data` — use `page.content`",
  },
  {
    pattern: "form\\.submitting",
    reason:
      '`form.submitting` was removed — use `useFormState(form, ["loading"])`',
  },
  {
    pattern: "router\\.navigate",
    reason:
      "`router.navigate` does not exist — use `router.push(name, { params })`",
  },
  {
    pattern: "cloudflare-d1:",
    reason: "the D1 protocol is `d1://`",
  },
  {
    pattern: "db migrations generate",
    reason: "the subcommand is `create` — `alepha db migrations create`",
  },
  // --- entries below were found stale in the docs during the 2026-08 audit ---
  {
    pattern: "TObject",
    reason: "TypeBox type name — the Zod object type is `ZObject`",
  },
  {
    pattern: "TSchema",
    reason: "TypeBox type name — the Zod schema type is `ZType`",
  },
  {
    pattern: "TString",
    reason: "TypeBox type name — use `ZodString`",
  },
  {
    pattern: "TUnion",
    reason: "TypeBox type name — use `ZodUnion`",
  },
  {
    pattern: "Static<",
    reason:
      "`Static<T>` was removed with TypeBox — the inference helper is `Infer<T>`",
  },
  {
    pattern: 'import \\{ Type \\} from "alepha"',
    reason:
      "`Type` is no longer exported — schemas built by `z` are ordinary Zod schemas; use their fluent API",
  },
  {
    pattern: "usePetitionUrl",
    reason: "renamed in the Petitions→Feedback rename — use `useFeedbackUrl`",
  },
  {
    pattern: "z\\.file\\(\\{ maxSize",
    reason:
      "the option is `maxBytes` (runtime-enforced by the multipart parser); `maxSize` would be silently ignored",
  },
  {
    pattern: "vitest\\.config\\.ts",
    reason:
      "init no longer writes `vitest.config.ts` — the `test` block lives in `vite.config.ts`",
  },
  {
    pattern: "AlephaServerHealth",
    reason: "removed — `/health` ships with `AlephaServer` itself",
  },
  {
    pattern: "\\$uiAdmin",
    reason: "removed with mantine — the admin surface is `$pageAdmin`",
  },
  {
    pattern: "\\$uiAuth",
    reason: "removed with mantine — mount `AuthRouter` from `@alepha/ui`",
  },
  {
    pattern: "SIGIL_SINK",
    reason: "replaced by the `sink` field inside `SIGIL_CONFIG`",
  },
];

/**
 * Link styles the docs must not use. The site's renderer emits hrefs verbatim
 * and its route table is a single flat `/docs/:slug` segment, so a relative
 * `.md` link or a nested `/docs/a/b` path renders fine on GitHub and 404s for
 * every site visitor — the 2026-08 audit found 16 of them.
 */
export const BANNED_LINK_PATTERNS: Array<{ pattern: string; reason: string }> =
  [
    {
      pattern: "\\]\\((?:\\./|\\.\\./)[^)]*\\.md",
      reason:
        "relative .md links 404 on the docs site — use the flat slug form, e.g. `/docs/guides-persistence-relations`",
    },
    {
      pattern: "\\]\\(/docs/[^)#]*/[^)]*\\)",
      reason:
        "nested /docs/a/b paths 404 — the route is a single flat slug, e.g. `/docs/cli-commands-init`",
    },
  ];

/**
 * A line carrying this marker, or the line before it, is exempt — for docs
 * that legitimately describe the old world (migration notes, changelogs).
 */
export const IGNORE_MARKER = "docs-check-ignore";

export class DocsChecker {
  protected readonly fs = $inject(FileSystemProvider);

  /**
   * Split markdown into its fenced blocks.
   *
   * Tracks the exact fence delimiter (``` vs ````) so a markdown sample that
   * *contains* a fence is one block, not three.
   */
  public parseFences(content: string): DocFence[] {
    const lines = content.split("\n");
    const fences: DocFence[] = [];

    let open:
      | { delim: string; lang: string; checked: boolean; line: number }
      | undefined;
    let body: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = /^(`{3,})(.*)$/.exec(line);

      if (open) {
        // Only a delimiter at least as long as the opening one closes it.
        if (match && match[1].length >= open.delim.length && !match[2].trim()) {
          fences.push({
            lang: open.lang,
            checked: open.checked,
            line: open.line,
            code: body.length ? `${body.join("\n")}\n` : "",
          });
          open = undefined;
          body = [];
        } else {
          body.push(line);
        }
        continue;
      }

      if (match) {
        const meta = match[2].trim();
        const [lang = "", ...rest] = meta.split(/\s+/);
        open = {
          delim: match[1],
          lang,
          // Whole word: fence meta also carries `{1,3}` line highlights and
          // `filename="x.ts"`, and neither should read as an opt-in.
          checked: rest.some((token) => token === "check"),
          line: i + 1,
        };
      }
    }

    return fences;
  }

  /**
   * Every opted-in TypeScript fence across the given files.
   */
  public async collectCheckedFences(files: string[]): Promise<DocUnit[]> {
    const units: DocUnit[] = [];

    for (const file of files) {
      const content = await this.fs.readFile(file);
      for (const fence of this.parseFences(String(content))) {
        if (!fence.checked || !this.isTypeScript(fence.lang)) {
          continue;
        }
        units.push({
          file,
          line: fence.line,
          code: fence.code,
          lang: fence.lang,
        });
      }
    }

    return units;
  }

  /**
   * Report every banned symbol across the given files.
   */
  public async check(files: string[]): Promise<DocViolation[]> {
    const violations: DocViolation[] = [];

    for (const file of files) {
      const content = String(await this.fs.readFile(file));
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        if (this.isIgnored(lines, i)) {
          continue;
        }

        for (const banned of BANNED_DOC_SYMBOLS) {
          if (!this.matches(lines[i], banned.pattern)) {
            continue;
          }
          violations.push({
            file,
            line: i + 1,
            message: `"${banned.pattern.replaceAll("\\", "")}" — ${banned.reason}`,
          });
        }

        for (const banned of BANNED_LINK_PATTERNS) {
          if (!new RegExp(banned.pattern).test(lines[i])) {
            continue;
          }
          violations.push({
            file,
            line: i + 1,
            message: `broken link style — ${banned.reason}`,
          });
        }
      }
    }

    return violations;
  }

  public isTypeScript(lang: string): boolean {
    return ["ts", "typescript", "tsx"].includes(lang);
  }

  /**
   * Whole-word match. `\b` alone is not enough for patterns that begin or end
   * with a non-word character (`t\.object`), so the boundaries are only
   * applied on the sides that are word characters.
   */
  protected matches(line: string, pattern: string): boolean {
    const first = pattern.replaceAll("\\", "")[0];
    const last = pattern.replaceAll("\\", "").at(-1) ?? "";
    const prefix = /\w/.test(first) ? "\\b" : "";
    const suffix = /\w/.test(last) ? "\\b" : "";
    return new RegExp(`${prefix}${pattern}${suffix}`).test(line);
  }

  /**
   * A line is exempt if it, or the line above it, carries the marker.
   */
  protected isIgnored(lines: string[], index: number): boolean {
    return (
      lines[index].includes(IGNORE_MARKER) ||
      (index > 0 && lines[index - 1].includes(IGNORE_MARKER))
    );
  }
}
