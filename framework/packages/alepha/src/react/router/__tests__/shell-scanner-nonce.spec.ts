import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { AlephaReactRouter, ReactServerTemplateProvider } from "../index.ts";

class TestTemplate extends ReactServerTemplateProvider {
  public scanner(onShell: () => void, onChunk: (c: Uint8Array) => void) {
    return this.shellScanner(onShell, onChunk);
  }
}

/**
 * With a CSP nonce React writes a longer opening tag around the shell
 * marker. Cut anywhere between two chunks, the tag must still be found
 * whole, never flushed in half.
 */
describe("shellScanner with a CSP nonce", () => {
  it("finds the marker tag wherever the stream is cut", async ({ expect }) => {
    const alepha = Alepha.create()
      .with({ provide: ReactServerTemplateProvider, use: TestTemplate })
      .with(AlephaReactRouter);
    await alepha.start();
    const template = alepha.inject(TestTemplate);
    const nonce = "q7cB0sRk0Zb1oXy4l3kD2w==";
    alepha.store.set("alepha.react.router.nonce", nonce);

    const before = "<main>shell</main>";
    const after = "<div>rest</div>";
    const html = `${before}<script nonce="${nonce}" id="_R_">${template.shellMarker}</script>${after}`;
    const bytes = new TextEncoder().encode(html);
    const decoder = new TextDecoder();

    for (let cut = 1; cut < bytes.length; cut++) {
      const out: string[] = [];
      let shells = 0;
      const scanner = template.scanner(
        () => {
          shells++;
          out.push("[SHELL]");
        },
        (chunk) => out.push(decoder.decode(chunk)),
      );
      for (const chunk of [bytes.subarray(0, cut), bytes.subarray(cut)]) {
        for (const part of scanner.scan(chunk)) {
          out.push(decoder.decode(part));
        }
      }
      for (const part of scanner.flush()) {
        out.push(decoder.decode(part));
      }

      expect(shells, `cut at ${cut}`).toBe(1);
      expect(out.join(""), `cut at ${cut}`).toBe(`${before}[SHELL]${after}`);
    }
    await alepha.stop();
  });
});
