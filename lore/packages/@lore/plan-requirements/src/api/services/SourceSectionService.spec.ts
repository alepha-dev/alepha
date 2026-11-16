import { describe, it } from "vitest";

import { SourceSectionService } from "./SourceSectionService.ts";

/**
 * Source changed's comparison (#E153, #Q3769): two bodies and one anchor.
 */
describe("SourceSectionService", () => {
  const service = new SourceSectionService();
  const spec = [
    "# Specification",
    "## 3. Promotions",
    "### 3.2 Promo codes!",
    "A code shows its discount in the cart.",
    "```",
    "## not a heading",
    "```",
    "### 3.3 Expiry",
    "Codes expire.",
    "## 4. Payment",
    "Pay once.",
  ].join("\n");

  it("slugs a heading as a heading link does", ({ expect }) => {
    expect(service.slug("3.2 Promo codes!")).toBe("32-promo-codes");
    expect(service.slug("Ça **marche**")).toBe("ça-marche");
  });

  it("reads a section to the next heading of the same or a higher level, skipping fences", ({
    expect,
  }) => {
    expect(service.section(spec, "32-promo-codes")?.text).toBe(
      "A code shows its discount in the cart.\n```\n## not a heading\n```",
    );
    expect(service.section(spec, "3-promotions")?.text).toContain(
      "Codes expire.",
    );
    expect(service.section(spec, "3-promotions")?.text).not.toContain(
      "Pay once.",
    );
  });

  it("says unchanged, edited or removed", ({ expect }) => {
    const synced = service.section(spec, "33-expiry")!.text;
    expect(service.compare(synced, spec, "33-expiry")).toBe("unchanged");
    expect(
      service.compare(
        synced,
        spec.replace("Codes expire.", "Codes expire after 30 days."),
        "33-expiry",
      ),
    ).toBe("edited");
    expect(
      service.compare(
        synced,
        spec.replace("### 3.3 Expiry", "### 3.3 Validity"),
        "33-expiry",
      ),
    ).toBe("removed");
  });
});
