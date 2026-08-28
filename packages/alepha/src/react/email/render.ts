import { type ComponentType, createElement } from "react";

/**
 * The doctype email clients want.
 *
 * Not HTML5. Outlook and a number of webmail clients parse XHTML 1.0
 * Transitional far more predictably, and it is what every mail-specific
 * renderer emits.
 */
const DOCTYPE =
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">';

/**
 * Turn a React component into an email body renderer.
 *
 * Takes the **component**, not an element: an element would have to be built
 * at declaration time, before any variables exist.
 *
 * ```typescript
 * body: render(WelcomeEmail)
 * ```
 *
 * The returned function is reusable and holds no state, so one `render(...)`
 * per template at class-field level is the intended shape.
 */
export const render =
  <P extends object>(Component: ComponentType<P>) =>
  async (props: P): Promise<string> => {
    const { renderToReadableStream } = await loadRenderer();

    let failure: unknown;
    const stream = await renderToReadableStream(
      createElement(Component as ComponentType<object>, props),
      {
        // An email is not progressively delivered: there is no point
        // flushing a shell early, and chunk boundaries would only make the
        // output harder to assert on.
        progressiveChunkSize: Number.POSITIVE_INFINITY,
        onError(error: unknown) {
          failure = error;
        },
      },
    );

    // Without this the stream can close having emitted only the shell, and a
    // suspended subtree would silently never reach the recipient.
    await stream.allReady;

    if (failure) {
      throw failure;
    }

    const html = await new Response(stream).text();
    return DOCTYPE + stripImagePreloads(html).replace(/<!DOCTYPE[^>]*>/i, "");
  };

/**
 * Load the renderer lazily.
 *
 * ⚠️ A static `import ... from "react-dom/server"` anywhere in the server
 * graph puts ~196 KB back on every cold start, silently, and nothing reports
 * that it happened. `ReactDomServerProvider`'s docstring is the long version.
 * This module is not injectable (a template's `body` is a bare closure with
 * no container), so it does its own dynamic import; the module registry
 * caches it, and it resolves to the same module the SSR path uses, so the
 * two share one chunk.
 */
const loadRenderer = async () => {
  try {
    return await import("react-dom/server.edge");
  } catch {
    return await import("react-dom/server");
  }
};

/**
 * Remove the `<link rel="preload" as="image">` tags React 19 injects for
 * every `<img>`.
 *
 * They are meaningless in an email and some clients render them as broken
 * content. Attributes are parsed rather than string-matched, so attribute
 * order and spacing cannot defeat it, and every other `<link>` (stylesheets,
 * fonts, author-written preloads) is left alone.
 *
 * @see https://github.com/resend/react-email/issues/3034
 */
const stripImagePreloads = (html: string): string =>
  html.replace(/<link\b[^>]*\/?>/gi, (tag) => {
    const attributes = parseAttributes(tag);
    return attributes.rel === "preload" && attributes.as === "image" ? "" : tag;
  });

const ATTRIBUTE =
  /([a-z][a-z0-9-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/gi;

const parseAttributes = (tag: string): Record<string, string> => {
  const body = tag.replace(/^<[a-z][a-z0-9-]*/i, "");
  const attributes: Record<string, string> = {};
  for (const [, name, double, single, bare] of body.matchAll(ATTRIBUTE)) {
    attributes[name.toLowerCase()] = double ?? single ?? bare ?? "";
  }
  return attributes;
};
