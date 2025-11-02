import { $inject, AlephaError } from "@alepha/core";
import { ServerProvider } from "@alepha/server";
import type {
  PageDescriptorRenderOptions,
  PageDescriptorRenderResult,
} from "../descriptors/$page.ts";
import { ReactServerProvider } from "../providers/ReactServerProvider.ts";
import { ReactPageService } from "./ReactPageService.ts";

export class ReactPageServerService extends ReactPageService {
  protected readonly reactServerProvider = $inject(ReactServerProvider);
  protected readonly serverProvider = $inject(ServerProvider);

  public async render(
    name: string,
    options: PageDescriptorRenderOptions = {},
  ): Promise<PageDescriptorRenderResult> {
    return this.reactServerProvider.render(name, options);
  }

  public async fetch(
    pathname: string,
    options: PageDescriptorRenderOptions = {},
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
    const match = html.match(this.reactServerProvider.ROOT_DIV_REGEX);
    if (match) {
      return { html: match[3], response };
    }

    throw new AlephaError("Invalid HTML response");
  }
}
