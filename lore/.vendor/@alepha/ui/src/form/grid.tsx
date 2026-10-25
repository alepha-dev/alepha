import * as React from "react";

void React;

import { z } from "alepha";
import type { BaseInputField } from "alepha/react/form";

/**
 * Decides the column-span (out of 12) for a control inside a 12-col grid.
 *
 * Rules (mirroring the legacy `CreateFormGroup.getBestSizeForInput`):
 * - explicit `$control.width` or per-field `width` override → use it
 * - `$control.area` / `file` / `upload` preset → 100% (full row)
 * - long text (`maxLength >= 256`) → 100%
 * - nested object / array of objects → 100%
 * - array of primitives → 66% (2/3 row)
 * - default → 33% (1/3 row)
 */
export const widthFor = (input: BaseInputField, override?: number): number => {
  if (override) return override;
  // Peel optional/nullable/default wrappers; `$control` rides on `.meta()`.
  const schema = z.schema.unwrap(input.schema) as {
    maxLength?: number;
    element?: unknown;
    meta?: () => {
      $control?: {
        width?: number;
        area?: boolean;
        file?: boolean;
        upload?: unknown;
      };
    };
  };
  const control = schema?.meta?.()?.$control;
  if (typeof control?.width === "number") return control.width;
  if (control?.area || control?.file || control?.upload) return 100;
  if ((schema?.maxLength ?? 0) >= 256) return 100;
  if (z.schema.isObject(schema)) return 100;
  if (z.schema.isArray(schema)) {
    const element = z.schema.unwrap(schema.element);
    if (z.schema.isObject(element)) return 100;
    if (z.schema.isString(element) || z.schema.isNumber(element)) return 66;
    return 100;
  }
  return 33;
};

/**
 * Maps a percentage width to a Tailwind `col-span-N` class on a 12-col grid.
 *
 * A partial width applies from `sm` (640px) up: below that every field takes
 * the whole row. A third of a phone-width form is a field too narrow to type
 * in, which is what a stacked form on mobile showed ("Name" at 180px beside
 * an empty two thirds).
 *
 * ⚠️ A viewport breakpoint, not a container query, although a container
 * query would also catch a narrow drawer on a desktop. `container-type:
 * inline-size` on the grid zeroes its intrinsic width, so a form inside a
 * shrink-to-fit parent (a `shrink-0` flex item, the showcase's knob panel)
 * would collapse to nothing.
 */
export const spanClass = (width: number): string => {
  if (width >= 100) return "col-span-12";
  if (width >= 75) return "col-span-12 sm:col-span-9";
  if (width >= 66) return "col-span-12 sm:col-span-8";
  if (width >= 50) return "col-span-12 sm:col-span-6";
  if (width >= 33) return "col-span-12 sm:col-span-4";
  if (width >= 25) return "col-span-12 sm:col-span-3";
  return "col-span-12 sm:col-span-4";
};
