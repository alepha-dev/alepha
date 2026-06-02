import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SigilRoot } from "../SigilRoot.tsx";

describe("SigilRoot", () => {
  it("opens the feedback dialog on button click", async () => {
    render(<SigilRoot />);
    fireEvent.click(screen.getByLabelText("Feedback"));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("closes the dialog via the close button", async () => {
    render(<SigilRoot />);
    fireEvent.click(screen.getByLabelText("Feedback"));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByLabelText("Close"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
