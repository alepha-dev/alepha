import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  FormField,
  formFieldAriaProps,
  useFormFieldA11y,
} from "../form-field.tsx";

const Probe = () => {
  const a11y = useFormFieldA11y();
  return (
    <input
      data-testid="probe"
      aria-invalid={a11y.invalid}
      aria-describedby={a11y.describedBy}
    />
  );
};

describe("FormField a11y wiring", () => {
  it("links the error message to the control via aria-describedby", () => {
    render(
      <FormField id="email" label="Email" error="Email is required">
        <Probe />
      </FormField>,
    );
    const input = screen.getByTestId("probe");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("email-error");

    const error = screen.getByRole("alert");
    expect(error.id).toBe("email-error");
    expect(error.textContent).toContain("Email is required");
  });

  it("links the description when there is no error", () => {
    render(
      <FormField id="name" label="Name" description="Your public name">
        <Probe />
      </FormField>,
    );
    const input = screen.getByTestId("probe");
    expect(input.getAttribute("aria-invalid")).toBe(null);
    expect(input.getAttribute("aria-describedby")).toBe("name-description");
    expect(document.getElementById("name-description")?.textContent).toBe(
      "Your public name",
    );
  });

  it("sets no aria attributes without id, error, or description", () => {
    render(
      <FormField label="Plain">
        <Probe />
      </FormField>,
    );
    const input = screen.getByTestId("probe");
    expect(input.getAttribute("aria-invalid")).toBe(null);
    expect(input.getAttribute("aria-describedby")).toBe(null);
  });

  it("formFieldAriaProps points at the same ids FormField renders", () => {
    render(
      <FormField id="pw" label="Password" error="Too short">
        <input
          data-testid="pw"
          {...formFieldAriaProps({ id: "pw", error: "Too short" })}
        />
      </FormField>,
    );
    const input = screen.getByTestId("pw");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(
      screen.getByRole("alert").id,
    );

    expect(
      formFieldAriaProps({ id: "x", description: "d" })["aria-describedby"],
    ).toBe("x-description");
    expect(formFieldAriaProps({})["aria-describedby"]).toBeUndefined();
  });

  it("wires the row layout the same way", () => {
    render(
      <FormField id="bio" label="Bio" layout="row" error="Too long">
        <Probe />
      </FormField>,
    );
    const input = screen.getByTestId("probe");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("bio-error");
    expect(screen.getByRole("alert").id).toBe("bio-error");
  });
});
