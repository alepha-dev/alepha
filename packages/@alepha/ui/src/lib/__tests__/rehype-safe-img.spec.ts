import { describe, expect, it } from "vitest";
import { parseSafeImg } from "../rehype-safe-img.ts";

/**
 * This is the whole XSS surface of the markdown reader, so it is tested
 * directly rather than through a render.
 *
 * The reader deliberately does NOT use `rehype-raw`: folio content is
 * user-authored, and this codebase escapes raw HTML everywhere else on
 * purpose. `parseSafeImg` is the single exception carved out for `<img>`,
 * which is what MDXEditor emits once an image has been resized — so what it
 * accepts, and only that, becomes renderable markup.
 */
describe("parseSafeImg", () => {
  describe("accepts", () => {
    it("a relative assets/ image", () => {
      expect(parseSafeImg('<img src="assets/photo.webp" />')).toEqual({
        src: "assets/photo.webp",
      });
    });

    it("a same-origin file URL", () => {
      expect(parseSafeImg('<img src="/api/files/abc" />')).toEqual({
        src: "/api/files/abc",
      });
    });

    it("the allowlisted attributes", () => {
      expect(
        parseSafeImg(
          '<img src="assets/a.png" alt="A cat" title="Tip" width="600" height="400">',
        ),
      ).toEqual({
        src: "assets/a.png",
        alt: "A cat",
        title: "Tip",
        width: "600",
        height: "400",
      });
    });

    it("single-quoted and unquoted attribute values", () => {
      expect(parseSafeImg("<img src='assets/a.png' width=600>")).toEqual({
        src: "assets/a.png",
        width: "600",
      });
    });
  });

  describe("drops attributes outside the allowlist", () => {
    it("an inline event handler", () => {
      expect(
        parseSafeImg('<img src="assets/a.png" onerror="alert(1)">'),
      ).toEqual({ src: "assets/a.png" });
    });

    it("onload, style, class and srcset", () => {
      expect(
        parseSafeImg(
          '<img src="assets/a.png" onload="x()" style="position:fixed" class="evil" srcset="https://evil.test/a 1x">',
        ),
      ).toEqual({ src: "assets/a.png" });
    });

    it("a non-numeric width", () => {
      // Width reaches a DOM attribute, so anything but digits is refused
      // rather than passed along to be interpreted.
      expect(parseSafeImg('<img src="assets/a.png" width="600px">')).toEqual({
        src: "assets/a.png",
      });
    });
  });

  describe("refuses the whole element", () => {
    const rejected = [
      ["a javascript: src", '<img src="javascript:alert(1)">'],
      ["an uppercase JavaScript: src", '<img src="JaVaScRiPt:alert(1)">'],
      [
        "a javascript: src with an embedded newline",
        '<img src="java\nscript:alert(1)">',
      ],
      ["a data: src", '<img src="data:image/svg+xml;base64,PHN2Zz4=">'],
      ["a remote http src", '<img src="http://evil.test/a.png">'],
      ["a remote https src", '<img src="https://evil.test/a.png">'],
      ["a protocol-relative src", '<img src="//evil.test/a.png">'],
      ["a src that escapes the folio", '<img src="../../etc/passwd">'],
      ["no src at all", '<img alt="nothing">'],
      ["an empty src", '<img src="">'],
    ] as const;

    for (const [label, html] of rejected) {
      it(label, () => {
        expect(parseSafeImg(html)).toBeUndefined();
      });
    }
  });

  describe("refuses anything that is not a lone img", () => {
    const rejected = [
      ["a script tag", "<script>alert(1)</script>"],
      ["an iframe", '<iframe src="/x"></iframe>'],
      ["an svg", '<svg onload="alert(1)"></svg>'],
      [
        "an img followed by a script",
        '<img src="assets/a.png"><script>x</script>',
      ],
      ["a tag that merely starts with img", '<image src="assets/a.png">'],
      ["plain text", "not html at all"],
      [
        "an anchor wrapping an img",
        '<a href="/x"><img src="assets/a.png"></a>',
      ],
    ] as const;

    for (const [label, html] of rejected) {
      it(label, () => {
        expect(parseSafeImg(html)).toBeUndefined();
      });
    }
  });
});
