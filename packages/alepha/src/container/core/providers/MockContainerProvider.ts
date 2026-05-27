import { $inject, Alepha, AlephaError } from "alepha";
import type { ContainerPrimitive } from "../primitives/$container.ts";
import {
  type ContainerInvokeConfig,
  ContainerProvider,
} from "./ContainerProvider.ts";

/**
 * In-process test provider.
 *
 * Resolves the action name against `LinkProvider`'s registered links in
 * the SAME Alepha instance — effectively calling the "containerized"
 * controller as if it were local. Use it in tests: register the
 * controller class on the test container alongside the consumer and
 * substitute `ContainerProvider` with `MockContainerProvider`.
 *
 * @example
 * ```ts
 * const alepha = Alepha.create()
 *   .with(AlephaContainer)
 *   .with(RocketController)
 *   .with(MyApp)
 *   .with({ provide: ContainerProvider, use: MockContainerProvider });
 * ```
 */
export class MockContainerProvider extends ContainerProvider {
  protected readonly alepha = $inject(Alepha);

  public override async invoke(
    container: ContainerPrimitive,
    action: string,
    config: ContainerInvokeConfig,
  ): Promise<unknown> {
    void container;
    // Lazy-resolve LinkProvider so tests that don't load `alepha/server/links`
    // still get a clear error message.
    const linkProviderClass = await this.loadLinkProvider();
    const linkProvider = this.alepha.inject(linkProviderClass) as {
      follow: (
        name: string,
        config?: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    return await linkProvider.follow(action, {
      body: config.body,
      query: config.query,
      params: config.params,
      headers: config.headers,
    });
  }

  protected async loadLinkProvider(): Promise<any> {
    try {
      const mod = await import("alepha/server/links");
      return mod.LinkProvider;
    } catch {
      throw new AlephaError(
        "MockContainerProvider needs 'alepha/server/links' to be available — add AlephaServerLinks to the test app.",
      );
    }
  }
}
