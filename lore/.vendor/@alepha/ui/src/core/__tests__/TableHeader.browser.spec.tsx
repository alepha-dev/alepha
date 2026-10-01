import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../Table.tsx";

/**
 * The header keeps as a permanent fill the tint a row only borrows on hover:
 * a header is not actionable, so lighting up under the pointer promised an
 * interaction it does not have.
 */
describe("TableHeader", () => {
  it("carries the permanent muted tint", () => {
    const { container } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Ada</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    const header = container.querySelector('[data-slot="table-header"]');
    expect(header?.tagName).toBe("THEAD");
    expect(header?.className).toContain("bg-muted/50");
    expect(
      container.querySelector('[data-slot="table-body"]')?.className ?? "",
    ).not.toContain("bg-muted/50");
  });
});
