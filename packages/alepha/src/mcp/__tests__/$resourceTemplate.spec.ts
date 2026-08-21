import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import {
  $resource,
  $resourceTemplate,
  AlephaMcp,
  McpServerProvider,
} from "../index.ts";

// ---------------------------------------------------------------------------------------------------------------------

const read = async (alepha: Alepha, uri: string) =>
  alepha.inject(McpServerProvider).handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "resources/read",
    params: { uri },
  });

describe("$resourceTemplate — matching", () => {
  class FolioResources {
    folio = $resourceTemplate({
      uriTemplate: "folio://{projectId}/{shortId}",
      description: "A folio by project and short id",
      mimeType: "text/markdown",
      variables: z.object({ projectId: z.text(), shortId: z.text() }),
      handler: async ({ variables, uri }) => ({
        text: `${uri} -> ${variables.projectId}/${variables.shortId}`,
      }),
    });
  }

  const start = async () => {
    const alepha = Alepha.create().with(AlephaMcp).with(FolioResources);
    await alepha.start();
    return alepha;
  };

  it("extracts variables from a concrete URI", async () => {
    const alepha = await start();

    const response = await read(alepha, "folio://1/86");
    const result = response?.result as {
      contents: Array<{ uri: string; text: string; mimeType: string }>;
    };

    expect(result.contents[0].text).toBe("folio://1/86 -> 1/86");
    expect(result.contents[0].uri).toBe("folio://1/86");
    expect(result.contents[0].mimeType).toBe("text/markdown");
  });

  it("percent-decodes a simple-expansion value", async () => {
    const alepha = await start();

    const response = await read(alepha, "folio://1/a%20b");
    const result = response?.result as { contents: Array<{ text: string }> };

    expect(result.contents[0].text).toContain("1/a b");
  });

  /** Simple expansion is one segment: it must not swallow a `/`. */
  it("does not match across a path separator", async () => {
    const alepha = await start();

    const response = await read(alepha, "folio://1/2/3");

    expect(response?.error?.code).toBe(-32602);
  });

  it("reports an unmatched URI as -32602", async () => {
    const alepha = await start();

    const response = await read(alepha, "other://thing");

    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain("other://thing");
  });

  it("advertises the template on resources/templates/list", async () => {
    const alepha = await start();

    const response = await alepha.inject(McpServerProvider).handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "resources/templates/list",
    });
    const result = response?.result as {
      resourceTemplates: Array<{ uriTemplate: string; name: string }>;
    };

    expect(result.resourceTemplates).toEqual([
      expect.objectContaining({
        uriTemplate: "folio://{projectId}/{shortId}",
        name: "folio",
        mimeType: "text/markdown",
      }),
    ]);
  });

  it("declares the resources capability even with no fixed resource", async () => {
    const alepha = await start();

    expect(
      alepha.inject(McpServerProvider).getCapabilities().resources,
    ).toEqual({});
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("$resourceTemplate — reserved expansion", () => {
  it("lets {+var} span path separators", async () => {
    class FileResources {
      file = $resourceTemplate({
        uriTemplate: "file:///{+path}",
        variables: z.object({ path: z.text() }),
        handler: async ({ variables }) => ({ text: variables.path }),
      });
    }

    const alepha = Alepha.create().with(AlephaMcp).with(FileResources);
    await alepha.start();

    const response = await read(alepha, "file:///a/b/c.md");
    const result = response?.result as { contents: Array<{ text: string }> };

    expect(result.contents[0].text).toBe("a/b/c.md");
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("$resourceTemplate — precedence", () => {
  class MixedResources {
    me = $resource({
      uri: "db://users/me",
      mimeType: "application/json",
      handler: async () => ({ text: '{"who":"me"}' }),
    });

    byId = $resourceTemplate({
      uriTemplate: "db://users/{id}",
      mimeType: "application/json",
      variables: z.object({ id: z.text() }),
      handler: async ({ variables }) => ({
        text: `{"who":"${variables.id}"}`,
      }),
    });
  }

  const start = async () => {
    const alepha = Alepha.create().with(AlephaMcp).with(MixedResources);
    await alepha.start();
    return alepha;
  };

  /**
   * `db://users/me` matches the template too. The concrete registration is the
   * deliberate special case, so it wins.
   */
  it("prefers a concrete resource over a template that also matches", async () => {
    const alepha = await start();

    const response = await read(alepha, "db://users/me");
    const result = response?.result as { contents: Array<{ text: string }> };

    expect(result.contents[0].text).toBe('{"who":"me"}');
  });

  it("falls through to the template for any other id", async () => {
    const alepha = await start();

    const response = await read(alepha, "db://users/42");
    const result = response?.result as { contents: Array<{ text: string }> };

    expect(result.contents[0].text).toBe('{"who":"42"}');
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("$resourceTemplate — validation", () => {
  /**
   * Every extracted value is a string until the schema says otherwise. A URI
   * whose variables fail that schema is a bad request, not a handler crash.
   */
  it("rejects a URI whose variables fail the schema with -32602", async () => {
    let handlerRan = false;

    class Resources {
      user = $resourceTemplate({
        uriTemplate: "db://users/{id}",
        variables: z.object({ id: z.uuid() }),
        handler: async () => {
          handlerRan = true;
          return { text: "never" };
        },
      });
    }

    const alepha = Alepha.create().with(AlephaMcp).with(Resources);
    await alepha.start();

    const response = await read(alepha, "db://users/not-a-uuid");

    expect(response?.error?.code).toBe(-32602);
    expect(handlerRan).toBe(false);
  });

  it("reports a well-formed but absent URI as not found", async () => {
    class Resources {
      folio = $resourceTemplate({
        uriTemplate: "folio://{id}",
        variables: z.object({ id: z.text() }),
        handler: async ({ variables }) =>
          variables.id === "1" ? { text: "here" } : undefined,
      });
    }

    const alepha = Alepha.create().with(AlephaMcp).with(Resources);
    await alepha.start();

    expect((await read(alepha, "folio://999"))?.error?.code).toBe(-32602);
    const found = (await read(alepha, "folio://1"))?.result as {
      contents: Array<{ text: string }>;
    };
    expect(found.contents[0].text).toBe("here");
  });

  /**
   * The template is compiled in `onInit`, so a malformed one fails as the
   * container wires it up — where the stack points at the declaration —
   * rather than compiling into a pattern that silently never matches.
   */
  it("refuses a template using an unsupported RFC 6570 operator", () => {
    class Resources {
      bad = $resourceTemplate({
        uriTemplate: "db://users{?filter}",
        handler: async () => ({ text: "" }),
      });
    }

    expect(() => Alepha.create().with(AlephaMcp).with(Resources)).toThrow(
      /Unsupported URI template/,
    );
  });

  it("refuses a template with no variables", () => {
    class Resources {
      bad = $resourceTemplate({
        uriTemplate: "db://users",
        handler: async () => ({ text: "" }),
      });
    }

    expect(() => Alepha.create().with(AlephaMcp).with(Resources)).toThrow(
      /declares no variables/,
    );
  });
});
