import { describe, expect, it } from "vitest";

import { sigilTrafficKind } from "../sigilTrafficKind.ts";

describe("sigilTrafficKind", () => {
  it("catches the crawlers that announce themselves", () => {
    // Every one of these was observed on alepha.dev in the week the filter was
    // written, so the list is a record rather than a guess.
    const bots = [
      "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.137 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.137 Mobile Safari/537.36 (compatible; GoogleOther)",
      "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)",
      "Mozilla/5.0 (compatible; cohere-ai/1.0; +https://cohere.com)",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.7680.165 Safari/537.36",
    ];

    for (const ua of bots) {
      expect(sigilTrafficKind(ua), ua).toBe("bot");
    }
  });

  it("matches `bot` at a word ending, not anywhere", () => {
    expect(sigilTrafficKind("GPTBot/1.0")).toBe("bot");
    expect(sigilTrafficKind("Twitterbot")).toBe("bot");
  });

  it("does not read a phone brand as a crawler", () => {
    // CUBOT is an Android handset. Being wrong here erases a reader, which is
    // the one direction this function may not be wrong in.
    expect(
      sigilTrafficKind(
        "Mozilla/5.0 (Linux; Android 10; CUBOT_X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe("human");
  });

  it("leaves an ordinary browser alone", () => {
    const humans = [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      "Mozilla/5.0 (X11; Linux x86_64; rv:153.0) Gecko/20100101 Firefox/153.0",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    ];

    for (const ua of humans) {
      expect(sigilTrafficKind(ua), ua).toBe("human");
    }
  });

  it("calls an undeclared scraper human, which is the known limit", () => {
    // The largest automated population on the docs app: one scraper rotating
    // Chrome/131 across three platforms out of Amazon ranges. No user-agent
    // test sees it. Pinned so nobody reads the filter as complete - the
    // engagement rate is what gives this one away.
    expect(
      sigilTrafficKind(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      ),
    ).toBe("human");
  });

  it("treats a missing user-agent as human", () => {
    expect(sigilTrafficKind(undefined)).toBe("human");
    expect(sigilTrafficKind("")).toBe("human");
  });
});
