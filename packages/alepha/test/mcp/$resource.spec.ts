import { Alepha } from "alepha";
import { $resource, AlephaMcp, McpServerProvider } from "alepha/mcp";
import { describe, expect, test } from "vitest";

// ---------------------------------------------------------------------------------------------------------------------

describe("$resource primitive", () => {
  test("should register resource with McpServerProvider", async () => {
    const alepha = Alepha.create();

    class Resources {
      readme = $resource({
        uri: "file:///readme",
        description: "Project README",
        handler: async () => ({ text: "# README" }),
      });
    }

    alepha.with(AlephaMcp).with(Resources);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const resource = provider.getResource("file:///readme");

    expect(resource).toBeDefined();
    expect(resource?.uri).toBe("file:///readme");
    expect(resource?.description).toBe("Project README");
  });

  test("should use property key as name when not provided", async () => {
    const alepha = Alepha.create();

    class Resources {
      myResource = $resource({
        uri: "test://resource",
        handler: async () => ({ text: "content" }),
      });
    }

    alepha.with(AlephaMcp).with(Resources);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const resource = provider.getResource("test://resource");

    expect(resource?.name).toBe("myResource");
  });

  test("should use custom name when provided", async () => {
    const alepha = Alepha.create();

    class Resources {
      myResource = $resource({
        uri: "test://resource",
        name: "Custom Resource Name",
        handler: async () => ({ text: "content" }),
      });
    }

    alepha.with(AlephaMcp).with(Resources);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const resource = provider.getResource("test://resource");

    expect(resource?.name).toBe("Custom Resource Name");
  });

  test("should return text content", async () => {
    const alepha = Alepha.create();

    class Resources {
      text = $resource({
        uri: "text://content",
        handler: async () => ({ text: "Hello, World!" }),
      });
    }

    alepha.with(AlephaMcp).with(Resources);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const resource = provider.getResource("text://content");

    const content = await resource?.read();
    expect(content?.text).toBe("Hello, World!");
  });

  test("should return binary content", async () => {
    const alepha = Alepha.create();

    const binaryData = new Uint8Array([1, 2, 3, 4, 5]);

    class Resources {
      binary = $resource({
        uri: "binary://data",
        mimeType: "application/octet-stream",
        handler: async () => ({ blob: binaryData }),
      });
    }

    alepha.with(AlephaMcp).with(Resources);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const resource = provider.getResource("binary://data");

    const content = await resource?.read();
    expect(content?.blob).toEqual(binaryData);
  });

  test("should use default mimeType when not provided", async () => {
    const alepha = Alepha.create();

    class Resources {
      plain = $resource({
        uri: "plain://text",
        handler: async () => ({ text: "plain text" }),
      });
    }

    alepha.with(AlephaMcp).with(Resources);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const resource = provider.getResource("plain://text");

    expect(resource?.mimeType).toBe("text/plain");
  });

  test("should use custom mimeType", async () => {
    const alepha = Alepha.create();

    class Resources {
      json = $resource({
        uri: "json://data",
        mimeType: "application/json",
        handler: async () => ({ text: '{"key": "value"}' }),
      });
    }

    alepha.with(AlephaMcp).with(Resources);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const resource = provider.getResource("json://data");

    expect(resource?.mimeType).toBe("application/json");
  });

  test("should generate correct descriptor", async () => {
    const alepha = Alepha.create();

    class Resources {
      config = $resource({
        uri: "config://app",
        name: "Application Config",
        description: "Application configuration file",
        mimeType: "application/json",
        handler: async () => ({ text: "{}" }),
      });
    }

    alepha.with(AlephaMcp).with(Resources);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const resource = provider.getResource("config://app");
    const descriptor = resource?.toDescriptor();

    expect(descriptor).toEqual({
      uri: "config://app",
      name: "Application Config",
      description: "Application configuration file",
      mimeType: "application/json",
    });
  });

  test("should handle async handlers", async () => {
    const alepha = Alepha.create();

    class Resources {
      async = $resource({
        uri: "async://resource",
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { text: "async content" };
        },
      });
    }

    alepha.with(AlephaMcp).with(Resources);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const resource = provider.getResource("async://resource");

    const content = await resource?.read();
    expect(content?.text).toBe("async content");
  });

  test("should propagate handler errors", async () => {
    const alepha = Alepha.create();

    class Resources {
      failing = $resource({
        uri: "failing://resource",
        handler: async () => {
          throw new Error("Resource read failed");
        },
      });
    }

    alepha.with(AlephaMcp).with(Resources);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const resource = provider.getResource("failing://resource");

    await expect(resource?.read()).rejects.toThrow("Resource read failed");
  });

  test("should handle dynamic content", async () => {
    const alepha = Alepha.create();

    let counter = 0;

    class Resources {
      dynamic = $resource({
        uri: "dynamic://counter",
        handler: async () => {
          counter++;
          return { text: `Count: ${counter}` };
        },
      });
    }

    alepha.with(AlephaMcp).with(Resources);
    await alepha.start();

    const provider = alepha.inject(McpServerProvider);
    const resource = provider.getResource("dynamic://counter");

    const content1 = await resource?.read();
    expect(content1?.text).toBe("Count: 1");

    const content2 = await resource?.read();
    expect(content2?.text).toBe("Count: 2");
  });
});
