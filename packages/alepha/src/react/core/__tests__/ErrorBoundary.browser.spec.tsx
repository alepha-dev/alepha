import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErrorBoundary } from "../components/ErrorBoundary.tsx";

const Boom = () => {
  throw new Error("boom");
};

const Fine = () => <div>fine</div>;

describe("ErrorBoundary", () => {
  const fallback = (error: Error) => <div>caught: {error.message}</div>;

  it("renders the fallback when a child throws", () => {
    render(
      <ErrorBoundary fallback={fallback}>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText("caught: boom")).toBeDefined();
  });

  /**
   * Without this, a route that throws latches the fallback forever: navigating
   * to a healthy page still shows the old error until a full page reload.
   */
  it("clears a caught error when a reset key changes", () => {
    const { rerender } = render(
      <ErrorBoundary fallback={fallback} resetKeys={["/broken"]}>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText("caught: boom")).toBeDefined();

    rerender(
      <ErrorBoundary fallback={fallback} resetKeys={["/healthy"]}>
        <Fine />
      </ErrorBoundary>,
    );

    expect(screen.getByText("fine")).toBeDefined();
    expect(screen.queryByText("caught: boom")).toBeNull();
  });

  it("keeps showing the fallback while the reset keys are unchanged", () => {
    const { rerender } = render(
      <ErrorBoundary fallback={fallback} resetKeys={["/broken"]}>
        <Boom />
      </ErrorBoundary>,
    );

    rerender(
      <ErrorBoundary fallback={fallback} resetKeys={["/broken"]}>
        <Fine />
      </ErrorBoundary>,
    );

    expect(screen.getByText("caught: boom")).toBeDefined();
  });

  it("still exposes a manual reset to the fallback", () => {
    let reset: (() => void) | undefined;
    const { rerender } = render(
      <ErrorBoundary
        fallback={(error, doReset) => {
          reset = doReset;
          return <div>caught: {error.message}</div>;
        }}
      >
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText("caught: boom")).toBeDefined();

    reset?.();
    rerender(
      <ErrorBoundary
        fallback={(error, doReset) => {
          reset = doReset;
          return <div>caught: {error.message}</div>;
        }}
      >
        <Fine />
      </ErrorBoundary>,
    );

    expect(screen.getByText("fine")).toBeDefined();
  });
});
