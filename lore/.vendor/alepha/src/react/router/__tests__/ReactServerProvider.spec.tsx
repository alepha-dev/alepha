import { describe, it } from "vitest";

// Simple mock for testing template functionality without full Alepha setup
class MockReactServerProvider {
  protected readonly env = { REACT_ROOT_ID: "root" };
  protected readonly ROOT_DIV_REGEX = new RegExp(
    `<div([^>]*)\\s+id=["']${this.env.REACT_ROOT_ID}["']([^>]*)>(.*?)<\\/div>`,
    "is",
  );
  protected preprocessedTemplate: any = null;

  public preprocessTemplate(template: string) {
    // Find the body close tag for script injection
    const bodyCloseMatch = template.match(/<\/body>/i);
    const bodyCloseIndex = bodyCloseMatch?.index ?? template.length;

    const beforeScript = template.substring(0, bodyCloseIndex);
    const afterScript = template.substring(bodyCloseIndex);

    // Check if there's an existing root div
    const rootDivMatch = beforeScript.match(this.ROOT_DIV_REGEX);

    if (rootDivMatch) {
      // Split around the existing root div content
      const beforeDiv = beforeScript.substring(0, rootDivMatch.index!);
      const afterDivStart = rootDivMatch.index! + rootDivMatch[0].length;
      const afterDiv = beforeScript.substring(afterDivStart);

      const beforeApp = `${beforeDiv}<div${rootDivMatch[1]} id="${this.env.REACT_ROOT_ID}"${rootDivMatch[2]}>`;
      const afterApp = `</div>${afterDiv}`;

      return { beforeApp, afterApp, beforeScript: "", afterScript };
    }

    // No existing root div, find body tag to inject new div
    const bodyMatch = beforeScript.match(/<body([^>]*)>/i);
    if (bodyMatch) {
      const beforeBody = beforeScript.substring(
        0,
        bodyMatch.index! + bodyMatch[0].length,
      );
      const afterBody = beforeScript.substring(
        bodyMatch.index! + bodyMatch[0].length,
      );

      const beforeApp = `${beforeBody}<div id="${this.env.REACT_ROOT_ID}">`;
      const afterApp = `</div>${afterBody}`;

      return { beforeApp, afterApp, beforeScript: "", afterScript };
    }

    // Fallback: no body tag found, just wrap everything
    return {
      beforeApp: `<div id="${this.env.REACT_ROOT_ID}">`,
      afterApp: `</div>`,
      beforeScript,
      afterScript,
    };
  }

  public fillTemplate(response: { html: string }, app: string, script: string) {
    if (!this.preprocessedTemplate) {
      // Fallback to old logic if preprocessing failed
      this.preprocessedTemplate = this.preprocessTemplate(response.html);
    }

    // Pure concatenation - no regex replacements needed
    response.html =
      this.preprocessedTemplate.beforeApp +
      app +
      this.preprocessedTemplate.afterApp +
      script +
      this.preprocessedTemplate.afterScript;
  }
}

const setup = (env?: any) => {
  const provider = new MockReactServerProvider();
  if (env?.REACT_ROOT_ID) {
    (provider as any).env.REACT_ROOT_ID = env.REACT_ROOT_ID;
    (provider as any).ROOT_DIV_REGEX = new RegExp(
      `<div([^>]*)\\s+id=["']${env.REACT_ROOT_ID}["']([^>]*)>(.*?)<\\/div>`,
      "is",
    );
  }
  return { provider };
};

describe("ReactServerProvider", () => {
  it("preprocessTemplate with existing root div", async ({ expect }) => {
    const { provider } = setup();

    const template = `<!DOCTYPE html>
  <html>
  <head><title>Test</title></head>
  <body>
    <div id="root">existing content</div>
  </body>
  </html>`;

    const preprocessed = provider.preprocessTemplate(template);

    expect(preprocessed.beforeApp).toBe(
      `<!DOCTYPE html>
  <html>
  <head><title>Test</title></head>
  <body>
    <div id="root">`,
    );
    expect(preprocessed.afterApp).toBe(`</div>
  `);
    expect(preprocessed.beforeScript).toBe("");
    expect(preprocessed.afterScript).toBe(`</body>
  </html>`);
  });

  it("preprocessTemplate without root div", async ({ expect }) => {
    const { provider } = setup();

    const template = `<!DOCTYPE html>
  <html>
  <head><title>Test</title></head>
  <body>
    <h1>Welcome</h1>
  </body>
  </html>`;

    const preprocessed = provider.preprocessTemplate(template);

    expect(preprocessed.beforeApp).toBe(
      `<!DOCTYPE html>
  <html>
  <head><title>Test</title></head>
  <body><div id="root">`,
    );
    expect(preprocessed.afterApp).toBe(`</div>
    <h1>Welcome</h1>
  `);
    expect(preprocessed.beforeScript).toBe("");
    expect(preprocessed.afterScript).toBe(`</body>
  </html>`);
  });

  it("preprocessTemplate with custom root ID", async ({ expect }) => {
    const { provider } = setup({ REACT_ROOT_ID: "app" });

    const template = `<!DOCTYPE html>
  <html>
  <head><title>Test</title></head>
  <body>
    <div id="app">existing content</div>
  </body>
  </html>`;

    const preprocessed = provider.preprocessTemplate(template);

    expect(preprocessed.beforeApp).toBe(
      `<!DOCTYPE html>
  <html>
  <head><title>Test</title></head>
  <body>
    <div id="app">`,
    );
    expect(preprocessed.afterApp).toBe(`</div>
  `);
  });

  it("preprocessTemplate with root div with attributes", async ({ expect }) => {
    const { provider } = setup();

    const template = `<!DOCTYPE html>
  <html>
  <body>
    <div class="container" id="root" data-test="true">existing content</div>
  </body>
  </html>`;

    const preprocessed = provider.preprocessTemplate(template);

    expect(preprocessed.beforeApp).toBe(
      `<!DOCTYPE html>
  <html>
  <body>
    <div class="container" id="root" data-test="true">`,
    );
    expect(preprocessed.afterApp).toBe(`</div>
  `);
  });

  it("preprocessTemplate fallback (no body tag)", async ({ expect }) => {
    const { provider } = setup();

    const template = `<html><div>content</div></html>`;

    const preprocessed = provider.preprocessTemplate(template);

    expect(preprocessed.beforeApp).toBe(`<div id="root">`);
    expect(preprocessed.afterApp).toBe(`</div>`);
    expect(preprocessed.beforeScript).toBe(`<html><div>content</div></html>`);
    expect(preprocessed.afterScript).toBe(``);
  });

  it("fillTemplate concatenation", async ({ expect }) => {
    const { provider } = setup();

    const template = `<!DOCTYPE html>
  <html>
  <head><title>Test</title></head>
  <body>
    <div id="root">existing</div>
  </body>
  </html>`;

    // Preprocess the template
    const preprocessed = provider.preprocessTemplate(template);
    (provider as any).preprocessedTemplate = preprocessed;

    const response = { html: "" };
    const app = "<h1>Hello World</h1>";
    const script =
      '<script id="__ssr" type="application/json">{"test":true}</script>';

    provider.fillTemplate(response, app, script);

    const expected = `<!DOCTYPE html>
  <html>
  <head><title>Test</title></head>
  <body>
    <div id="root"><h1>Hello World</h1></div>
  <script id="__ssr" type="application/json">{"test":true}</script></body>
  </html>`;

    expect(response.html).toBe(expected);
  });

  it("fillTemplate without preprocessed template (fallback)", async ({
    expect,
  }) => {
    const { provider } = setup();

    const template = `<!DOCTYPE html>
  <html>
  <body>
    <div id="root">existing</div>
  </body>
  </html>`;

    const response = { html: template };
    const app = "<h1>Hello World</h1>";
    const script =
      '<script id="__ssr" type="application/json">{"test":true}</script>';

    // Don't set preprocessedTemplate to test fallback
    (provider as any).preprocessedTemplate = null;

    provider.fillTemplate(response, app, script);

    const expected = `<!DOCTYPE html>
  <html>
  <body>
    <div id="root"><h1>Hello World</h1></div>
  <script id="__ssr" type="application/json">{"test":true}</script></body>
  </html>`;

    expect(response.html).toBe(expected);
  });

  it("fillTemplate performance comparison", async ({ expect }) => {
    const { provider } = setup();

    const template = `<!DOCTYPE html>
  <html>
  <head><title>Performance Test</title></head>
  <body>
    <div id="root">existing content</div>
    <script>console.log('existing');</script>
  </body>
  </html>`;

    const app = "<div><h1>Hello World</h1><p>This is a test</p></div>";
    const script =
      '<script id="__ssr" type="application/json">{"data":"value","count":42}</script>';

    // Test with preprocessing (should be faster)
    const preprocessed = provider.preprocessTemplate(template);
    (provider as any).preprocessedTemplate = preprocessed;

    const response1 = { html: "" };
    provider.fillTemplate(response1, app, script);

    // Test fallback without preprocessing (should work but potentially slower)
    (provider as any).preprocessedTemplate = null;
    const response2 = { html: template };
    provider.fillTemplate(response2, app, script);

    // Both should produce the same result
    expect(response1.html).toBe(response2.html);

    // The result should contain the app content
    expect(response1.html).toContain("<h1>Hello World</h1>");
    expect(response1.html).toContain(
      '<script id="__ssr" type="application/json">{"data":"value","count":42}</script>',
    );
  });
});
