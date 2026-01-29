import type { Head, HeadMeta } from "../interfaces/Head.ts";

/**
 * Expands Head configuration into SEO meta tags.
 *
 * Generates:
 * - `<meta name="description">` from head.description
 * - `<meta property="og:*">` OpenGraph tags
 * - `<meta name="twitter:*">` Twitter Card tags
 *
 * @example
 * ```ts
 * const helper = new SeoExpander();
 * const { meta, link } = helper.expand({
 *   title: "My App",
 *   description: "Build amazing apps",
 *   image: "https://example.com/og.png",
 *   url: "https://example.com/",
 * });
 * ```
 */
export class SeoExpander {
  public expand(head: Head): {
    meta: HeadMeta[];
    link: Array<{ rel: string; href: string }>;
  } {
    const meta: HeadMeta[] = [];
    const link: Array<{ rel: string; href: string }> = [];

    // Only expand SEO if there's meaningful content beyond just title
    const hasSeoContent =
      head.description ||
      head.image ||
      head.url ||
      head.siteName ||
      head.locale ||
      head.type ||
      head.og ||
      head.twitter;

    if (!hasSeoContent) {
      return { meta, link };
    }

    // Base description
    if (head.description) {
      meta.push({ name: "description", content: head.description });
    }

    // Canonical URL
    if (head.url) {
      link.push({ rel: "canonical", href: head.url });
    }

    // OpenGraph tags
    this.expandOpenGraph(head, meta);

    // Twitter Card tags
    this.expandTwitter(head, meta);

    return { meta, link };
  }

  protected expandOpenGraph(head: Head, meta: HeadMeta[]): void {
    const ogTitle = head.og?.title ?? head.title;
    const ogDescription = head.og?.description ?? head.description;
    const ogImage = head.og?.image ?? head.image;

    if (head.type || ogTitle) {
      meta.push({ property: "og:type", content: head.type ?? "website" });
    }
    if (head.url) {
      meta.push({ property: "og:url", content: head.url });
    }
    if (ogTitle) {
      meta.push({ property: "og:title", content: ogTitle });
    }
    if (ogDescription) {
      meta.push({ property: "og:description", content: ogDescription });
    }
    if (ogImage) {
      meta.push({ property: "og:image", content: ogImage });
      if (head.imageWidth) {
        meta.push({
          property: "og:image:width",
          content: String(head.imageWidth),
        });
      }
      if (head.imageHeight) {
        meta.push({
          property: "og:image:height",
          content: String(head.imageHeight),
        });
      }
      if (head.imageAlt) {
        meta.push({ property: "og:image:alt", content: head.imageAlt });
      }
    }
    if (head.siteName) {
      meta.push({ property: "og:site_name", content: head.siteName });
    }
    if (head.locale) {
      meta.push({ property: "og:locale", content: head.locale });
    }
  }

  protected expandTwitter(head: Head, meta: HeadMeta[]): void {
    const twitterTitle = head.twitter?.title ?? head.title;
    const twitterDescription = head.twitter?.description ?? head.description;
    const twitterImage = head.twitter?.image ?? head.image;

    if (head.twitter?.card || twitterTitle || twitterImage) {
      meta.push({
        name: "twitter:card",
        content:
          head.twitter?.card ??
          (twitterImage ? "summary_large_image" : "summary"),
      });
    }
    if (head.url) {
      meta.push({ name: "twitter:url", content: head.url });
    }
    if (twitterTitle) {
      meta.push({ name: "twitter:title", content: twitterTitle });
    }
    if (twitterDescription) {
      meta.push({ name: "twitter:description", content: twitterDescription });
    }
    if (twitterImage) {
      meta.push({ name: "twitter:image", content: twitterImage });
      if (head.imageAlt) {
        meta.push({ name: "twitter:image:alt", content: head.imageAlt });
      }
    }
    if (head.twitter?.site) {
      meta.push({ name: "twitter:site", content: head.twitter.site });
    }
    if (head.twitter?.creator) {
      meta.push({ name: "twitter:creator", content: head.twitter.creator });
    }
  }
}
