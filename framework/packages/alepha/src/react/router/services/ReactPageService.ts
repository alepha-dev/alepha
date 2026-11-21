import { AlephaError } from "alepha";

import type {
  PagePrimitiveRenderOptions,
  PagePrimitiveRenderResult,
} from "../primitives/$page.ts";

/**
 * What `$page` methods (`render`, `fetch`, `invalidate`) call. This base
 * refuses each one, and is what the browser registers: the server
 * substitutes `ReactPageServerService`.
 */
export abstract class ReactPageService {
  public fetch(
    name: string,
    options: PagePrimitiveRenderOptions = {},
  ): Promise<{
    html: string;
    response: Response;
  }> {
    throw new AlephaError("Fetch is not available for this environment.");
  }

  public render(
    name: string,
    options: PagePrimitiveRenderOptions = {},
  ): Promise<PagePrimitiveRenderResult> {
    throw new AlephaError("Render is not available for this environment.");
  }

  public invalidate(
    name: string,
    params?: Record<string, unknown>,
  ): Promise<void> {
    throw new AlephaError(
      "Page invalidation is server-side only: call it from an action or a job.",
    );
  }
}
