import { describe, it } from "vitest";

import { renderDevicePage } from "../helpers/devicePage.ts";

/**
 * The device-flow approval page, #Q2217. Same constraints as the consent
 * screen beside it: one self-contained document, every value escaped.
 */
describe("renderDevicePage", () => {
  it("asks for the code, keeping whatever was already typed", ({ expect }) => {
    const html = renderDevicePage({ step: "enter", userCode: "CDFG-HJKM" });

    expect(html).toContain('<form method="GET" action="/oauth/device"');
    expect(html).toContain('name="user_code"');
    expect(html).toContain('value="CDFG-HJKM"');
  });

  it("says why it is asking again, when a code was refused", ({ expect }) => {
    const html = renderDevicePage({
      step: "enter",
      error: "That code is no good.",
    });

    expect(html).toContain("That code is no good.");
  });

  it("posts the decision with the code, and offers both answers", ({
    expect,
  }) => {
    const html = renderDevicePage({
      step: "confirm",
      userCode: "CDFG-HJKM",
      userName: "Bob",
      scopes: [{ id: "mcp", label: "Your projects" }],
    });

    expect(html).toContain('<form method="POST" action="/oauth/device"');
    expect(html).toContain(
      '<input type="hidden" name="user_code" value="CDFG-HJKM" />',
    );
    expect(html).toContain('value="allow"');
    expect(html).toContain('value="deny"');
    expect(html).toContain("Your projects");
    expect(html).toContain("Bob");
  });

  /**
   * RFC 8628 §5.4. The code is the one thing tying this page to the device in
   * front of the human, so the page has to tell them to compare it - and to
   * refuse a code they did not ask for, which is what a phishing link hands
   * them.
   */
  it("tells the human to compare the code and refuse one they did not start", ({
    expect,
  }) => {
    const html = renderDevicePage({
      step: "confirm",
      userCode: "CDFG-HJKM",
      userName: "Bob",
      scopes: [],
    });

    expect(html).toContain("matches the code on your device");
    expect(html).toContain("did not start this");
  });

  it("names the product the device is signing in to, and never invents one", ({
    expect,
  }) => {
    const confirm = {
      step: "confirm" as const,
      userCode: "CDFG-HJKM",
      userName: "Bob",
      scopes: [],
    };

    expect(renderDevicePage({ ...confirm, productName: "Lore" })).toContain(
      "your Lore account",
    );
    expect(renderDevicePage(confirm)).toContain("your account");
  });

  it("says which way it went, and that the device is the next place to look", ({
    expect,
  }) => {
    expect(renderDevicePage({ step: "done", decision: "allow" })).toContain(
      "Device connected",
    );
    expect(renderDevicePage({ step: "done", decision: "deny" })).toContain(
      "Request denied",
    );
  });

  it("requests nothing from the network", ({ expect }) => {
    const html = renderDevicePage({
      step: "confirm",
      userCode: "CDFG-HJKM",
      userName: "Bob",
      scopes: [{ id: "mcp" }],
      productName: "Lore",
    });

    expect(html).not.toContain("<script");
    expect(html).not.toContain("<link");
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
    expect(html).toContain("<style>");
  });

  it("escapes every value it is handed", ({ expect }) => {
    const confirm = renderDevicePage({
      step: "confirm",
      userCode: '"><script>x</script>',
      userName: '"><img src=x onerror=alert(1)>',
      productName: "<b>Lore</b>",
      scopes: [{ id: "<x>", label: "<y>", description: "<z>" }],
    });
    const enter = renderDevicePage({
      step: "enter",
      userCode: '"><script>y</script>',
      error: "<i>no</i>",
    });

    expect(confirm).not.toContain("<script>x</script>");
    expect(confirm).not.toContain("<img src=x");
    expect(confirm).not.toContain("<b>Lore</b>");
    expect(confirm).not.toContain("<y>");
    expect(confirm).not.toContain("<z>");
    expect(enter).not.toContain("<script>y</script>");
    expect(enter).not.toContain("<i>no</i>");
  });
});
