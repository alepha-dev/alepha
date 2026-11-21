import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FileImage } from "../FileImage.tsx";

describe("FileImage", () => {
  it("swaps in the fallback on a load error, and still calls the caller's onError", () => {
    const errors: string[] = [];
    const { container } = render(
      <FileImage
        id="00000000-0000-4000-8000-00000000000c"
        fallback={<span>Initials</span>}
        onError={(event) => errors.push(event.type)}
      />,
    );

    fireEvent.error(container.querySelector("img")!);

    expect(screen.getByText("Initials")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(errors).toEqual(["error"]);
  });
});
