import { AlephaError } from "alepha";
import type {
  PagePrimitiveRenderOptions,
  PagePrimitiveRenderResult,
} from "../primitives/$page.ts";

/**
 * $page methods interface.
 */
export abstract class ReactPageService {
  public fetch(
    pathname: string,
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
}
