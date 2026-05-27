import { Alepha, t } from "alepha";
import { $action, AlephaServer } from "alepha/server";
import { AlephaServerLinks } from "alepha/server/links";
import { describe, it } from "vitest";
import { AlephaContainer } from "../index.ts";
import { $container } from "../primitives/$container.ts";
import { ContainerProvider } from "../providers/ContainerProvider.ts";
import { NodeContainerProvider } from "../providers/NodeContainerProvider.ts";

describe("$container", () => {
  it("routes proxy calls through the active provider", async ({ expect }) => {
    class RocketController {
      createJob = $action({
        schema: {
          body: t.object({ op: t.text() }),
          response: t.object({ jobId: t.text(), status: t.text() }),
        },
        handler: async ({ body }) => ({
          jobId: `job-${body.op}`,
          status: "queued",
        }),
      });
    }

    class DeployService {
      rocket = $container<RocketController>({
        image: "alepha/rocket:latest",
      });
    }

    // In test mode AlephaContainer binds the Mock provider by default,
    // which routes the proxy's `.createJob(...)` call back through
    // LinkProvider — so RocketController must live on the same Alepha.
    const alepha = Alepha.create({ env: { LOG_LEVEL: "warn" } })
      .with(AlephaServer)
      .with(AlephaServerLinks)
      .with(AlephaContainer)
      .with(RocketController)
      .with(DeployService);

    await alepha.start();

    const service = alepha.inject(DeployService);
    const result = await alepha.context.run(() =>
      (service.rocket as any).createJob({ body: { op: "up" } }),
    );
    expect(result).toStrictEqual({ jobId: "job-up", status: "queued" });
  });

  it("exposes the underlying primitive via instanceof + name", ({ expect }) => {
    class App {
      rocket = $container({
        image: "alepha/rocket:latest",
        name: "rocket",
      });
    }

    const alepha = Alepha.create({ env: {} }).with(AlephaContainer).with(App);

    // Force App instantiation so the primitive registers.
    const app = alepha.inject(App);
    expect((app.rocket as any).name).toBe("rocket");
    expect((app.rocket as any).options.image).toBe("alepha/rocket:latest");
    expect(alepha.primitives($container).length).toBe(1);
  });

  it("throws when a Node container has no URL", async ({ expect }) => {
    class App {
      rocket = $container({ image: "alepha/rocket:latest" });
    }

    const alepha = Alepha.create({ env: {} })
      .with({ provide: ContainerProvider, use: NodeContainerProvider })
      .with(AlephaContainer)
      .with(App);
    await alepha.start();

    const app = alepha.inject(App);
    await expect(
      alepha.context.run(() => (app.rocket as any).deploy({ body: {} })),
    ).rejects.toThrow(/no 'url' configured/i);
  });
});
