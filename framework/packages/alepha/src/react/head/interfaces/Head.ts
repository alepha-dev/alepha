/**
 * Complete head configuration combining basic head elements with SEO fields.
 *
 * @example
 * ```ts
 * $head({
 *   title: "My App",
 *   description: "Build amazing apps",
 *   image: "https://example.com/og.png",
 *   url: "https://example.com/",
 *   siteName: "My App",
 *   twitter: { card: "summary_large_image" },
 * })
 * ```
 */
export interface Head extends SimpleHead, Seo {}

/**
 * SEO configuration for automatic meta tag generation.
 * Fields are used for meta description, OpenGraph, and Twitter Card tags.
 */
export interface Seo {
  /**
   * Page description - used for meta description, og:description, twitter:description
   */
  description?: string;
  /**
   * Primary image URL - used for og:image and twitter:image
   */
  image?: string;
  /**
   * Canonical URL - used for og:url and link rel="canonical"
   */
  url?: string;
  /**
   * Site name - used for og:site_name
   */
  siteName?: string;
  /**
   * Locale - used for og:locale (e.g., "en_US")
   */
  locale?: string;
  /**
   * Content type - used for og:type (default: "website")
   */
  type?: "website" | "article" | "product" | "profile" | (string & {});
  /**
   * Image width in pixels - used for og:image:width
   */
  imageWidth?: number;
  /**
   * Image height in pixels - used for og:image:height
   */
  imageHeight?: number;
  /**
   * Image alt text - used for og:image:alt and twitter:image:alt
   */
  imageAlt?: string;

  /**
   * Twitter-specific overrides
   */
  twitter?: {
    /**
     * Twitter card type
     */
    card?: "summary" | "summary_large_image" | "app" | "player";
    /**
     * @username of website
     */
    site?: string;
    /**
     * @username of content creator
     */
    creator?: string;
    /**
     * Override title for Twitter
     */
    title?: string;
    /**
     * Override description for Twitter
     */
    description?: string;
    /**
     * Override image for Twitter
     */
    image?: string;
  };

  /**
   * OpenGraph-specific overrides
   */
  og?: {
    /**
     * Override title for OpenGraph
     */
    title?: string;
    /**
     * Override description for OpenGraph
     */
    description?: string;
    /**
     * Override image for OpenGraph
     */
    image?: string;
  };
}

export interface SimpleHead {
  title?: string;
  titleSeparator?: string;
  /**
   * Document charset - defaults to "UTF-8" if not specified
   */
  charset?: string;
  /**
   * Viewport content - defaults to "width=device-width, initial-scale=1" if not specified
   */
  viewport?: string;
  htmlAttributes?: Record<string, string>;
  bodyAttributes?: Record<string, string>;
  /**
   * Meta tags - supports both name and property attributes
   */
  meta?: Array<HeadMeta>;
  /**
   * Link tags (e.g., stylesheets, preload, canonical)
   */
  link?: Array<HeadLink>;
  /**
   * Script tags - string for inline code, or object with attributes
   */
  script?: Array<
    | string
    | (Record<string, string | boolean | undefined> & {
        /**
         * Inline JavaScript code
         */
        content?: string;
      })
  >;
}

/**
 * `crossorigin` on a link.
 *
 * `true` renders the bare `crossorigin=""`, which HTML already reads as an
 * anonymous request; the two named values render verbatim.
 *
 * It used to be typed `string` and rendered as `""` whatever it held, so
 * `use-credentials` could be written but never took effect: a preload for a
 * credentialed fetch silently became an anonymous one, and the browser then
 * refused to reuse it for the real request - a double download, and no error
 * anywhere to say why.
 */
export type HeadLinkCrossOrigin = true | "anonymous" | "use-credentials";

export interface HeadLink {
  rel: string;
  href: string;
  type?: string;
  as?: string;
  crossorigin?: HeadLinkCrossOrigin;
  /**
   * Media query — used for theme-aware icons and responsive stylesheets.
   * e.g. `(prefers-color-scheme: dark)` to ship a dark-mode favicon.
   */
  media?: string;
  /**
   * Sizes attribute — used for icon link tags (e.g. `"32x32"`, `"any"`).
   */
  sizes?: string;
  /**
   * Hreflang attribute — used for `rel="alternate"` localized variants.
   */
  hreflang?: string;
  /**
   * Subresource Integrity (`sha384-...`): the browser refuses the file if
   * its bytes do not match. The build fills it for its own scripts and
   * stylesheets.
   */
  integrity?: string;
}

export interface HeadMeta {
  /**
   * Meta name attribute (e.g., "description", "twitter:card")
   */
  name?: string;
  /**
   * Meta property attribute (e.g., "og:title", "og:image")
   */
  property?: string;
  /**
   * Meta content value
   */
  content: string;
  /**
   * Media query the tag applies to (e.g., "(prefers-color-scheme: dark)").
   *
   * Only `theme-color` uses this in practice, and it is the reason the field
   * exists: a site with a light and a dark palette declares one tag per scheme
   * and lets the browser pick, rather than painting the address bar and the
   * PWA splash screen a single colour that is wrong half the time.
   *
   * Two tags sharing a `name` are kept apart by this value, so a
   * media-qualified tag and an unqualified one can coexist.
   */
  media?: string;
}

/**
 * A head computed after every page's own, from the page that was matched.
 *
 * A page's `head` sees its own props and the head above it, and the deepest
 * page wins. That is right for a page that knows its title, and wrong for a
 * title that is a rule of the whole app: a breadcrumb trail drawn by a layout
 * from shared state, which no single page can see. `afterPages` runs once all
 * page heads have merged, on the server and in the browser alike, receives the
 * merged head and the matched layers (deepest last), and what it returns is
 * merged over them. Return `undefined` to leave the head as the pages left it.
 *
 * ```ts
 * class Titles {
 *   head = $head({
 *     afterPages: ({ layers }) => {
 *       const page = layers[layers.length - 1];
 *       return page?.name === "invoice"
 *         ? { title: `Invoices › ${page.params?.id}` }
 *         : undefined;
 *     },
 *   });
 * }
 * ```
 */
export interface HeadAfterPages {
  afterPages: (context: HeadAfterPagesContext) => Head | undefined;
}

export interface HeadAfterPagesContext {
  /**
   * The head as the global entries and every page left it.
   */
  head: Head;
  /**
   * The matched pages, outermost first: each one's `name` and `params`.
   */
  layers: ReadonlyArray<{
    name?: string;
    params?: Record<string, any>;
    error?: Error;
  }>;
}
