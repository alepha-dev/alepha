import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import type { Head } from "../interfaces/Head.ts";
import { HeadProvider } from "../providers/HeadProvider.ts";

/**
 * A JSON data block (`application/ld+json`, `application/json`) is written
 * between `<script>` tags, where the first `</script>` of its content closes
 * the element whatever JSON string it sits in. The filled head carries the
 * content with `<` written as a JSON escape, which parses to the same value
 * and cannot close anything.
 */
describe("HeadProvider JSON data blocks", () => {
  const payload = { name: "</script><script>alert(1)</script>  " };

  const scriptsOf = (head: Head) =>
    (head.script ?? []).map((it) => (typeof it === "string" ? it : it.content));

  it("escapes a page's JSON-LD so it cannot close its script element", () => {
    const provider = Alepha.create().inject(HeadProvider);
    const state: { head: Head; layers: any[] } = {
      head: {},
      layers: [
        {
          route: {
            head: {
              script: [
                {
                  type: "application/ld+json",
                  content: JSON.stringify(payload),
                },
              ],
            },
          },
        },
      ],
    };

    provider.fillHead(state);

    const [content] = scriptsOf(state.head);
    expect(content).not.toContain("<");
    expect(content).not.toContain(" ");
    expect(content).not.toContain(" ");
    expect(JSON.parse(content!)).toEqual(payload);
  });

  it("escapes a global JSON block, in the filled head and in the shell's", () => {
    const provider = Alepha.create().inject(HeadProvider);
    provider.global = [
      () => ({
        script: [
          { type: "application/json", content: JSON.stringify(payload) },
        ],
      }),
    ];
    const state: { head: Head; layers: any[] } = { head: {}, layers: [] };

    provider.fillHead(state);

    for (const head of [state.head, provider.resolveGlobal()]) {
      const [content] = scriptsOf(head);
      expect(content).not.toContain("<");
      expect(JSON.parse(content!)).toEqual(payload);
    }
  });

  it("escapes JSON blocks whatever the spelling of their type", () => {
    const provider = Alepha.create().inject(HeadProvider);
    const types = [
      "application/ld+json; charset=utf-8",
      " Application/JSON ",
      "importmap",
      "speculationrules",
    ];
    provider.global = [
      {
        script: types.map((type) => ({
          type,
          content: JSON.stringify(payload),
        })),
      },
    ];
    const state: { head: Head; layers: any[] } = { head: {}, layers: [] };

    provider.fillHead(state);

    const once = scriptsOf(state.head);
    for (const content of once) {
      expect(content).not.toContain("<");
      expect(JSON.parse(content!)).toEqual(payload);
    }

    // A second pass (the renderer escapes too) changes nothing.
    provider.global = [
      {
        script: types.map((type, i) => ({ type, content: once[i] })),
      },
    ];
    const again: { head: Head; layers: any[] } = { head: {}, layers: [] };
    provider.fillHead(again);
    expect(scriptsOf(again.head)).toEqual(once);
  });

  it("neutralises the closing tag of a data block that is not JSON", () => {
    const provider = Alepha.create().inject(HeadProvider);
    provider.global = [
      {
        script: [
          {
            type: "text/plain",
            content: "a < b </script><!--<script>alert(1)</SCRIPT> <!-- c",
          },
        ],
      },
    ];
    const state: { head: Head; layers: any[] } = { head: {}, layers: [] };

    provider.fillHead(state);

    const [content] = scriptsOf(state.head);
    expect(content).toBe(
      "a < b <\\/script><\\!--<script>alert(1)<\\/SCRIPT> <!-- c",
    );
  });

  it("leaves a comment that hides no closing tag as written", () => {
    const provider = Alepha.create().inject(HeadProvider);
    const template = "<!-- header -->\n<h1>{{title}}</h1>";
    const shader = "float f = c<!--d ? 1.0 : 0.0;";
    provider.global = [
      {
        script: [
          { type: "text/template", content: template },
          { type: "x-shader/x-fragment", content: shader },
        ],
      },
    ];
    const state: { head: Head; layers: any[] } = { head: {}, layers: [] };

    provider.fillHead(state);

    expect(scriptsOf(state.head)).toEqual([template, shader]);
  });

  it("leaves executable scripts as they are", () => {
    const provider = Alepha.create().inject(HeadProvider);
    const inline = "if (a < b) { run(); }";
    provider.global = [
      {
        script: [
          inline,
          { content: inline },
          { type: "module", content: inline },
          { type: "text/javascript", content: inline },
        ],
      },
    ];
    const state: { head: Head; layers: any[] } = { head: {}, layers: [] };

    provider.fillHead(state);

    expect(scriptsOf(state.head)).toEqual([inline, inline, inline, inline]);
  });
});
