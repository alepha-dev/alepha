import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScreenshotEditor } from "../ScreenshotEditor.tsx";

describe("ScreenshotEditor", () => {
  it("renders a canvas and mode controls", () => {
    const { container } = render(
      <ScreenshotEditor
        image="data:image/png;base64,iVBORw0KGgo="
        onImageChange={() => {}}
        onRecapture={() => {}}
      />,
    );
    expect(container.querySelector("canvas")).toBeTruthy();
  });

  it("renders Draw and Crop mode buttons", () => {
    const { container } = render(
      <ScreenshotEditor
        image="data:image/png;base64,iVBORw0KGgo="
        onImageChange={() => {}}
        onRecapture={() => {}}
      />,
    );
    const buttons = container.querySelectorAll("button");
    const labels = Array.from(buttons).map((b) => b.textContent?.trim());
    expect(labels).toContain("Draw");
    expect(labels).toContain("Crop");
  });

  it("renders a Recapture button", () => {
    const { container } = render(
      <ScreenshotEditor
        image="data:image/png;base64,iVBORw0KGgo="
        onImageChange={() => {}}
        onRecapture={() => {}}
      />,
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.some((b) => b.textContent?.trim() === "Recapture")).toBe(
      true,
    );
  });

  it("calls onRecapture when the Recapture button is clicked", () => {
    let called = false;
    const { container } = render(
      <ScreenshotEditor
        image="data:image/png;base64,iVBORw0KGgo="
        onImageChange={() => {}}
        onRecapture={() => {
          called = true;
        }}
      />,
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    const recaptureBtn = buttons.find(
      (b) => b.textContent?.trim() === "Recapture",
    );
    recaptureBtn?.click();
    expect(called).toBe(true);
  });

  it("has Draw mode active by default", () => {
    const { container } = render(
      <ScreenshotEditor
        image="data:image/png;base64,iVBORw0KGgo="
        onImageChange={() => {}}
        onRecapture={() => {}}
      />,
    );
    const drawBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Draw",
    );
    expect(drawBtn?.getAttribute("aria-pressed")).toBe("true");
  });
});
