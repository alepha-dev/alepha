import { describe, expect, it } from "vitest";
import { pulseFingerprintSource } from "../pulseFingerprint.ts";

describe("pulseFingerprintSource", () => {
  it("keeps one identity across a rebuild", () => {
    // The reason this function exists. Same bug, two deploys: the bundle hash
    // and the line numbers move, the group must not.
    const before = pulseFingerprintSource(
      "TypeError",
      "TypeError: x\n    at render (https://app/entry.iHryQ0pA.js:12:44)",
    );
    const after = pulseFingerprintSource(
      "TypeError",
      "TypeError: x\n    at render (https://app/entry.Zk8_pQ12.js:98:7)",
    );

    expect(after).toBe(before);
  });

  it("separates different throw sites", () => {
    const a = pulseFingerprintSource(
      "TypeError",
      "TypeError: x\n    at render (app.js:1:1)",
    );
    const b = pulseFingerprintSource(
      "TypeError",
      "TypeError: x\n    at save (app.js:1:1)",
    );

    expect(a).not.toBe(b);
  });

  it("separates different error names at the same site", () => {
    const stack = "boom\n    at render (app.js:1:1)";

    expect(pulseFingerprintSource("TypeError", stack)).not.toBe(
      pulseFingerprintSource("RangeError", stack),
    );
  });

  it("uses the first frame, not the message line", () => {
    // The message is attacker-controlled and often carries an id or a value;
    // fingerprinting on it would make every occurrence a new group.
    const withId = pulseFingerprintSource(
      "Error",
      "Error: user 4711 not found\n    at load (app.js:3:9)",
    );
    const withOther = pulseFingerprintSource(
      "Error",
      "Error: user 9999 not found\n    at load (app.js:3:9)",
    );

    expect(withOther).toBe(withId);
  });

  it("still fingerprints a stack with no frames", () => {
    // Some browsers hand over a bare message. Collapsing all of those into one
    // group would be worse than grouping them by their text.
    const a = pulseFingerprintSource("Error", "Script error.");
    const b = pulseFingerprintSource("Error", "Out of memory");

    expect(a).not.toBe(b);
    expect(a).not.toBe("");
  });

  it("carries no app identifier, so a fingerprint survives moving sinks", () => {
    const fp = pulseFingerprintSource(
      "Error",
      "Error: x\n    at f (app.js:1:1)",
    );

    expect(fp).toBe("Error:at f (app.js)");
  });
});
