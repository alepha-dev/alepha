import { $inject, AlephaError } from "alepha";
import { ServerProvider } from "alepha/server";
import type {
  PagePrimitiveRenderOptions,
  PagePrimitiveRenderResult,
} from "../primitives/$page.ts";
import { ReactServerProvider } from "../providers/ReactServerProvider.ts";
import { ReactServerTemplateProvider } from "../providers/ReactServerTemplateProvider.ts";
import { ReactPageService } from "./ReactPageService.ts";

/**
 * $page methods for server-side.
 */
export class ReactPageServerService extends ReactPageService {
  protected readonly reactServerProvider = $inject(ReactServerProvider);
  protected readonly templateProvider = $inject(ReactServerTemplateProvider);
  protected readonly serverProvider = $inject(ServerProvider);

  public async render(
    name: string,
    options: PagePrimitiveRenderOptions = {},
  ): Promise<PagePrimitiveRenderResult> {
    return this.reactServerProvider.render(name, options);
  }

  public async fetch(
    pathname: string,
    options: PagePrimitiveRenderOptions = {},
  ): Promise<{
    html: string;
    response: Response;
  }> {
    const response = await fetch(`${this.serverProvider.hostname}/${pathname}`);

    const html = await response.text();
    if (options?.html) {
      return { html, response };
    }

    // take only text inside the root div
    const rootContent = this.templateProvider.extractRootContent(html);
    if (rootContent !== undefined) {
      return { html: rootContent, response };
    }

    throw new AlephaError("Invalid HTML response");
  }
}
