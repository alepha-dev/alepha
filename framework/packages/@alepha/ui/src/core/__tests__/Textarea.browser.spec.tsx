import { render } from "@testing-library/react";
import { describe, it } from "vitest";
import { Textarea } from "../Textarea.tsx";

/**
 * `field-sizing-content` makes the browser ignore `rows`, so `Textarea`
 * carries `rows` as a minimum height instead (#Q4120).
 */
describe("Textarea", () => {
  it("should turn rows into a minimum height", ({ expect }) => {
    const { container } = render(<Textarea rows={8} />);
    const box = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(box.style.getPropertyValue("--textarea-min-h")).toBe(
      "max(4rem, calc(8lh + 1rem + 2px))",
    );
    expect(box.className).toContain("min-h-[var(--textarea-min-h,4rem)]");
  });

  it("should keep the 4rem floor without rows", ({ expect }) => {
    const { container } = render(<Textarea />);
    const box = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(box.style.getPropertyValue("--textarea-min-h")).toBe("");
    expect(box.className).toContain("min-h-[var(--textarea-min-h,4rem)]");
  });

  it("should let a caller's min-h class win over rows", ({ expect }) => {
    const { container } = render(<Textarea rows={8} className="min-h-48" />);
    const box = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(box.className).toContain("min-h-48");
    expect(box.className).not.toContain("min-h-[var(--textarea-min-h");
  });

  it("should keep the caller's own style", ({ expect }) => {
    const { container } = render(
      <Textarea rows={2} style={{ maxHeight: "10rem" }} />,
    );
    const box = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(box.style.maxHeight).toBe("10rem");
    expect(box.style.getPropertyValue("--textarea-min-h")).not.toBe("");
  });
});
