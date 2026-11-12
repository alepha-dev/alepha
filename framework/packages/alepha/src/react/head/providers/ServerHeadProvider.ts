import { $inject } from "alepha";

import type { Head, SimpleHead } from "../interfaces/Head.ts";
import { HeadProvider } from "./HeadProvider.ts";

/**
 * Server-side head provider that fills head content from route configurations.
 *
 * Used by ReactServerProvider to collect title, meta tags, and other head
 * elements which are then rendered by ReactServerTemplateProvider.
 */
export class ServerHeadProvider {
  protected readonly headProvider = $inject(HeadProvider);

  /**
   * Resolve global head configuration (htmlAttributes only).
   *
   * Used for early streaming optimization - htmlAttributes can be sent
   * before page loaders run since they come from global $head only.
   */
  public resolveGlobalHead(): Head {
    return this.headProvider.resolveGlobalHead();
  }

  /**
   * Resolve every global `$head` entry in full (title, meta, link, script,
   * attributes), with no page involved. What an app shell's document carries.
   */
  public resolveGlobal(): Head {
    return this.headProvider.resolveGlobal();
  }

  /**
   * The executable inline scripts of every global `$head` given a literal
   * object: constant for the life of the app, so the CSP allows them by
   * their hash. A `$head` function is evaluated per render and is not here.
   */
  public constantInlineScripts(): string[] {
    const scripts: string[] = [];
    for (const head of this.headProvider.global ?? []) {
      if (typeof head !== "object") {
        continue;
      }
      for (const script of head.script ?? []) {
        const content = this.executableInlineContent(script);
        if (content) {
          scripts.push(content);
        }
      }
    }
    return scripts;
  }

  /**
   * The content of a `$head` script entry when the browser executes it
   * inline, the exact text written between `<script>` and `</script>`:
   * no `src`, and no data `type` such as `application/json` or
   * `application/ld+json`, which CSP does not govern.
   */
  public executableInlineContent(
    script: NonNullable<SimpleHead["script"]>[number],
  ): string | undefined {
    if (typeof script === "string") {
      return script || undefined;
    }
    if (script.src || !script.content) {
      return undefined;
    }
    const type = script.type;
    if (
      typeof type === "string" &&
      type !== "" &&
      type !== "module" &&
      !/^(text|application)\/(x-)?(java|ecma)script$/i.test(type)
    ) {
      return undefined;
    }
    return script.content;
  }

  /**
   * The executable inline scripts of a piece of HTML, each the exact text
   * between `<script ...>` and `</script>`: what a browser hashes. Scripts
   * with a `src`, data blocks (`type="application/json"`...) and empty ones
   * are left out.
   *
   * Used on the head `alepha dev` builds from Vite, whose plugins add inline
   * scripts of their own (the React refresh preamble), so the CSP can allow
   * every one of them by its hash without listing them.
   */
  public inlineScriptsOf(html: string): string[] {
    const scripts: string[] = [];
    for (const [, attrs, body] of html.matchAll(
      /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    )) {
      const src = /\bsrc\s*=/i.test(attrs);
      const type = attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i)?.[1];
      const content = this.executableInlineContent(
        src ? { src: "x" } : { type, content: body },
      );
      if (content) {
        scripts.push(content);
      }
    }
    return scripts;
  }

  /**
   * Fill head state from route configurations.
   * Delegates to HeadProvider to merge head data from all route layers.
   */
  public fillHead(state: { head: SimpleHead; layers: Array<any> }): void {
    this.headProvider.fillHead(state);
  }
}
