import { $page } from "@alepha/react/router";
import { Alepha } from "alepha";
import { describe, it } from "vitest";
import { $head, AlephaReactHead } from "../../src/head/index.ts";

class App {
  head = $head({
    title: "Alepha Framework",
    description: "TypeScript framework made easy",
    image: "https://alepha.dev/og-image.png",
    url: "https://alepha.dev/",
    siteName: "Alepha",
    locale: "en_US",
    type: "website",
    imageWidth: 1200,
    imageHeight: 630,
    twitter: {
      card: "summary_large_image",
    },
  });

  home = $page({
    component: () => "Home",
  });
}

const alepha = Alepha.create().with(AlephaReactHead);
const a = alepha.inject(App);

describe("SEO Head", () => {
  it("should render page with SEO meta tags", async ({ expect }) => {
    const result = await a.home.render({ html: true, hydration: false });

    // Should include description
    expect(result.html).toContain(
      '<meta name="description" content="TypeScript framework made easy">',
    );

    // Should include OpenGraph tags with property attribute
    expect(result.html).toContain(
      '<meta property="og:title" content="Alepha Framework">',
    );
    expect(result.html).toContain(
      '<meta property="og:description" content="TypeScript framework made easy">',
    );
    expect(result.html).toContain(
      '<meta property="og:image" content="https://alepha.dev/og-image.png">',
    );
    expect(result.html).toContain(
      '<meta property="og:url" content="https://alepha.dev/">',
    );
    expect(result.html).toContain('<meta property="og:type" content="website">');
    expect(result.html).toContain(
      '<meta property="og:site_name" content="Alepha">',
    );
    expect(result.html).toContain(
      '<meta property="og:locale" content="en_US">',
    );
    expect(result.html).toContain(
      '<meta property="og:image:width" content="1200">',
    );
    expect(result.html).toContain(
      '<meta property="og:image:height" content="630">',
    );

    // Should include Twitter Card tags with name attribute
    expect(result.html).toContain(
      '<meta name="twitter:card" content="summary_large_image">',
    );
    expect(result.html).toContain(
      '<meta name="twitter:title" content="Alepha Framework">',
    );
    expect(result.html).toContain(
      '<meta name="twitter:description" content="TypeScript framework made easy">',
    );
    expect(result.html).toContain(
      '<meta name="twitter:image" content="https://alepha.dev/og-image.png">',
    );

    // Should include canonical link
    expect(result.html).toContain(
      '<link rel="canonical" href="https://alepha.dev/">',
    );
  });
});

class AppWithPageSeo {
  head = $head({
    title: "My Site",
    titleSeparator: " | ",
  });

  blog = $page({
    path: "/blog",
    head: {
      title: "Blog",
      description: "Read our latest articles",
      image: "https://example.com/blog-og.png",
      type: "article",
    },
    component: () => "Blog",
  });
}

const alepha2 = Alepha.create().with(AlephaReactHead);
const app2 = alepha2.inject(AppWithPageSeo);

describe("SEO Head on Page", () => {
  it("should render page-level SEO", async ({ expect }) => {
    const result = await app2.blog.render({ html: true, hydration: false });

    expect(result.html).toContain("<title>Blog | My Site</title>");
    expect(result.html).toContain(
      '<meta name="description" content="Read our latest articles">',
    );
    expect(result.html).toContain('<meta property="og:type" content="article">');
    expect(result.html).toContain(
      '<meta property="og:image" content="https://example.com/blog-og.png">',
    );
  });
});
