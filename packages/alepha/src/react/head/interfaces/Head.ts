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
  type?: "website" | "article" | "product" | "profile" | string;
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

export interface HeadLink {
  rel: string;
  href: string;
  type?: string;
  as?: string;
  crossorigin?: string;
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
