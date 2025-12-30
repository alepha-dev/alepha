import { Alepha } from "alepha";
import { describe, it } from "vitest";
import { SeoExpander } from "../../src/head/helpers/SeoExpander.ts";

describe("SeoExpander", () => {
  it("should expand basic SEO configuration", ({ expect }) => {
    const alepha = Alepha.create();
    const seoExpander = alepha.inject(SeoExpander);

    const result = seoExpander.expand({
      title: "My App",
      description: "Build amazing apps",
      url: "https://example.com/",
    });

    expect(result.meta).toContainEqual({
      name: "description",
      content: "Build amazing apps",
    });
    expect(result.meta).toContainEqual({
      property: "og:title",
      content: "My App",
    });
    expect(result.meta).toContainEqual({
      property: "og:description",
      content: "Build amazing apps",
    });
    expect(result.meta).toContainEqual({
      property: "og:url",
      content: "https://example.com/",
    });
    expect(result.meta).toContainEqual({
      property: "og:type",
      content: "website",
    });
    expect(result.meta).toContainEqual({
      name: "twitter:title",
      content: "My App",
    });
    expect(result.meta).toContainEqual({
      name: "twitter:description",
      content: "Build amazing apps",
    });
    expect(result.link).toContainEqual({
      rel: "canonical",
      href: "https://example.com/",
    });
  });

  it("should expand full SEO configuration with image", ({ expect }) => {
    const alepha = Alepha.create();
    const seoExpander = alepha.inject(SeoExpander);

    const result = seoExpander.expand({
      title: "Alepha Framework",
      description: "TypeScript framework made easy",
      image: "https://alepha.dev/og-image.png",
      url: "https://alepha.dev/",
      siteName: "Alepha",
      locale: "en_US",
      type: "website",
      imageWidth: 1200,
      imageHeight: 630,
      imageAlt: "Alepha Framework Logo",
    });

    // OpenGraph tags
    expect(result.meta).toContainEqual({
      property: "og:image",
      content: "https://alepha.dev/og-image.png",
    });
    expect(result.meta).toContainEqual({
      property: "og:image:width",
      content: "1200",
    });
    expect(result.meta).toContainEqual({
      property: "og:image:height",
      content: "630",
    });
    expect(result.meta).toContainEqual({
      property: "og:image:alt",
      content: "Alepha Framework Logo",
    });
    expect(result.meta).toContainEqual({
      property: "og:site_name",
      content: "Alepha",
    });
    expect(result.meta).toContainEqual({
      property: "og:locale",
      content: "en_US",
    });

    // Twitter tags
    expect(result.meta).toContainEqual({
      name: "twitter:image",
      content: "https://alepha.dev/og-image.png",
    });
    expect(result.meta).toContainEqual({
      name: "twitter:image:alt",
      content: "Alepha Framework Logo",
    });
    // With image, default to summary_large_image
    expect(result.meta).toContainEqual({
      name: "twitter:card",
      content: "summary_large_image",
    });
  });

  it("should support Twitter-specific overrides", ({ expect }) => {
    const alepha = Alepha.create();
    const seoExpander = alepha.inject(SeoExpander);

    const result = seoExpander.expand({
      title: "Base Title",
      description: "Base description",
      twitter: {
        card: "summary",
        site: "@alepha_dev",
        creator: "@johndoe",
        title: "Twitter-specific Title",
      },
    });

    expect(result.meta).toContainEqual({
      name: "twitter:card",
      content: "summary",
    });
    expect(result.meta).toContainEqual({
      name: "twitter:site",
      content: "@alepha_dev",
    });
    expect(result.meta).toContainEqual({
      name: "twitter:creator",
      content: "@johndoe",
    });
    expect(result.meta).toContainEqual({
      name: "twitter:title",
      content: "Twitter-specific Title",
    });
    // OG should still use base title
    expect(result.meta).toContainEqual({
      property: "og:title",
      content: "Base Title",
    });
  });

  it("should support OpenGraph-specific overrides", ({ expect }) => {
    const alepha = Alepha.create();
    const seoExpander = alepha.inject(SeoExpander);

    const result = seoExpander.expand({
      title: "Base Title",
      description: "Base description",
      og: {
        title: "OG-specific Title",
        description: "OG-specific description",
      },
    });

    expect(result.meta).toContainEqual({
      property: "og:title",
      content: "OG-specific Title",
    });
    expect(result.meta).toContainEqual({
      property: "og:description",
      content: "OG-specific description",
    });
    // Twitter should use base
    expect(result.meta).toContainEqual({
      name: "twitter:title",
      content: "Base Title",
    });
    expect(result.meta).toContainEqual({
      name: "twitter:description",
      content: "Base description",
    });
  });

  it("should handle article type", ({ expect }) => {
    const alepha = Alepha.create();
    const seoExpander = alepha.inject(SeoExpander);

    const result = seoExpander.expand({
      title: "Blog Post",
      type: "article",
    });

    expect(result.meta).toContainEqual({
      property: "og:type",
      content: "article",
    });
  });

  it("should return empty arrays for empty config", ({ expect }) => {
    const alepha = Alepha.create();
    const seoExpander = alepha.inject(SeoExpander);

    const result = seoExpander.expand({});

    expect(result.meta).toEqual([]);
    expect(result.link).toEqual([]);
  });
});
