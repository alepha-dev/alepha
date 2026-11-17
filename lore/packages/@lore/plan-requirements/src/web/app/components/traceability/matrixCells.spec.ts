import { describe, expect, it } from "vitest";

import {
  personaUseCaseCell,
  requirementEpicCell,
  requirementUseCaseCell,
} from "./matrixCells.ts";

const criterion = (useCaseNumber: number, result?: string) =>
  ({ useCaseNumber, result }) as never;

describe("matrix cells", () => {
  const uc = (state: string, stale = false) =>
    ({ number: 7, state, stale, actors: [{ number: 2 }] }) as never;

  it("reads a requirement against a use case from its criteria", () => {
    expect(requirementUseCaseCell({ criteria: [] }, uc("passed"))).toBe("none");
    expect(
      requirementUseCaseCell(
        { criteria: [criterion(7, "passed")] },
        uc("passed"),
      ),
    ).toBe("verified");
    expect(
      requirementUseCaseCell(
        { criteria: [criterion(7, "passed")] },
        uc("passed", true),
      ),
    ).toBe("stale");
    expect(
      requirementUseCaseCell(
        { criteria: [criterion(7, "failed")] },
        uc("failed"),
      ),
    ).toBe("failing");
    expect(
      requirementUseCaseCell(
        { criteria: [criterion(7, "failed")] },
        uc("in_development"),
      ),
    ).toBe("in_development");
    expect(
      requirementUseCaseCell({ criteria: [criterion(7)] }, uc("never_run")),
    ).toBe("never_run");
  });

  it("reads a requirement against an epic from its status", () => {
    const req = (status: string) =>
      ({ status, coveringEpics: [{ number: 5 }] }) as never;
    expect(requirementEpicCell(req("verified"), 5)).toBe("verified");
    expect(requirementEpicCell(req("covered"), 5)).toBe("never_run");
    expect(requirementEpicCell(req("verified"), 6)).toBe("none");
  });

  it("reads a persona against a use case from its run state", () => {
    expect(personaUseCaseCell(2, uc("passed"))).toBe("verified");
    expect(personaUseCaseCell(2, uc("failed"))).toBe("failing");
    expect(personaUseCaseCell(3, uc("passed"))).toBe("none");
  });
});
