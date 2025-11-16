import { AlephaError } from "alepha";
import type {
  PageDescriptorRenderOptions,
  PageDescriptorRenderResult,
} from "../descriptors/$page.ts";

export class ReactPageService {
  public fetch(
    pathname: string,
    options: PageDescriptorRenderOptions = {},
  ): Promise<{
    html: string;
    response: Response;
  }> {
    throw new AlephaError("Fetch is not available for this environment.");
  }

  public render(
    name: string,
    options: PageDescriptorRenderOptions = {},
  ): Promise<PageDescriptorRenderResult> {
    throw new AlephaError("Render is not available for this environment.");
  }
}
