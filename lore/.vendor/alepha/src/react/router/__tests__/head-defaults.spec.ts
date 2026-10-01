import { Alepha } from "alepha";
import { $head, AlephaReactHead } from "alepha/react/head";
import { describe, it } from "vitest";

import { $page } from "../index.ts";

class AppNoHead {
  home = $page({
    component: () => "Home",
  });
}

const alepha1 = Alepha.create().with(AlephaReactHead);
const app1 = alepha1.inject(AppNoHead);

describe("Head defaults", () => {
  it("should use lang=en and title=App when no head is configured", async ({
    expect,
  }) => {
    const result = await app1.home.render({ html: true, hydration: false });

    expect(result.html).toContain('<html lang="en">');
    expect(result.html).toContain("<title>App</title>");
  });
});

class AppWithHead {
  head = $head({
    title: "My Site",
    htmlAttributes: { lang: "fr" },
  });

  home = $page({
    component: () => "Home",
  });
}

const alepha2 = Alepha.create().with(AlephaReactHead);
const app2 = alepha2.inject(AppWithHead);

describe("Head overrides", () => {
  it("should use custom lang and title when configured", async ({ expect }) => {
    const result = await app2.home.render({ html: true, hydration: false });

    expect(result.html).toContain('<html lang="fr">');
    expect(result.html).toContain("<title>My Site</title>");
    expect(result.html).not.toContain('<html lang="en">');
    expect(result.html).not.toContain("<title>App</title>");
  });
});
