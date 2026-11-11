import { $inject, $store, Alepha } from "alepha";

import { WebhookDestinationRefusedError } from "../errors/WebhookDestinationRefusedError.ts";
import { webhookOptions } from "../schemas/webhookOptionsAtom.ts";
import { WebhookAddressResolver } from "./WebhookAddressResolver.ts";

/**
 * What keeps a webhook sender, a machine that POSTs to URLs somebody typed
 * into a form, from being a way into the app's own network.
 *
 * Applied twice: when an endpoint is created or its URL edited (the literal
 * rules, nothing resolved: a name that does not resolve yet is legitimate
 * to register), and before every delivery (the literal rules again, then,
 * on Node and Bun, every address the host resolves to).
 *
 * **The literal rules**, on every runtime:
 * - no credentials (`user:pass@`) and no fragment, ever;
 * - in production: `https` only, port 443 or one of
 *   `webhookOptions.allowedPorts`, and a host that is not an address in a
 *   private, loopback, link-local, unique-local, shared, multicast,
 *   reserved or unspecified range (IPv4 and IPv6, IPv4-mapped and NAT64
 *   included, in any spelling the URL parser normalises), nor `localhost`,
 *   a `.localhost`, `.local` or `.internal` name, nor an undotted name.
 *
 * Outside production, and with `allowPrivateDestinations`, only the first
 * rule applies, so a developer can point an endpoint at `localhost`.
 *
 * **The resolved check**, on Node and Bun only, before each delivery: one
 * private address among the answers refuses it. Nothing is pinned, so DNS
 * rebinding between this check and the request's own resolution is not
 * stopped; on workerd there is no resolver at all.
 *
 * A service, so an app with a legitimate internal receiver configures or
 * substitutes it. A refusal names the host, never the URL.
 */
export class WebhookDestinationPolicy {
  protected readonly alepha = $inject(Alepha);
  protected readonly resolver = $inject(WebhookAddressResolver);
  protected readonly options = $store(webhookOptions);

  /**
   * The literal rules: throws {@link WebhookDestinationRefusedError} on the
   * `url` field.
   */
  public checkUrl(url: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw this.refuse("not a valid URL");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw this.refuse("only http and https URLs can receive webhooks");
    }
    if (parsed.username !== "" || parsed.password !== "") {
      throw this.refuse("a URL with credentials is not allowed");
    }
    if (parsed.hash !== "") {
      throw this.refuse("a URL with a fragment is not allowed");
    }
    if (!this.strict()) return parsed;

    if (parsed.protocol !== "https:") {
      throw this.refuse("webhooks are sent over https only");
    }
    if (
      parsed.port !== "" &&
      !this.options.allowedPorts.includes(Number(parsed.port))
    ) {
      throw this.refuse(`port ${parsed.port} is not allowed`);
    }
    const host = parsed.hostname.toLowerCase();
    if (this.isLocalName(host)) {
      throw this.refuse(`${host} is a local name`);
    }
    if (this.isPrivateAddress(host)) {
      throw this.refuse(`${host} is a private address`);
    }
    return parsed;
  }

  /**
   * Before a delivery: the literal rules, then every address the host
   * resolves to (Node and Bun). Throws on a refusal, and lets a failed
   * lookup throw too: both are failed attempts the job retries.
   */
  public async checkDelivery(url: string): Promise<void> {
    const parsed = this.checkUrl(url);
    if (!this.strict()) return;
    const host = parsed.hostname.toLowerCase();
    if (this.parseIPv4(host) || host.startsWith("[")) return;
    const addresses = await this.resolver.resolve(host);
    if (!addresses) return;
    for (const address of addresses) {
      if (this.isPrivateAddress(address)) {
        throw this.refuse(`${host} resolves to a private address`);
      }
    }
  }

  /**
   * Whether the range and name rules apply: in production, unless the app
   * allows private destinations.
   */
  protected strict(): boolean {
    return this.alepha.isProduction() && !this.options.allowPrivateDestinations;
  }

  protected refuse(message: string) {
    return new WebhookDestinationRefusedError(
      { part: "body", issues: [{ path: "/url", message }] },
      { message: `Webhook destination refused: ${message}` },
    );
  }

  /**
   * `localhost`, the `.localhost`, `.local` and `.internal` names (cloud
   * metadata names among them), and any undotted name: the names the OAuth
   * metadata fetch refuses too.
   */
  public isLocalName(host: string): boolean {
    if (host.startsWith("[") || this.parseIPv4(host)) return false;
    return (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      !host.includes(".")
    );
  }

  /**
   * Whether `address` (an IPv4 or IPv6 literal, bracketed or not) lies in a
   * range a public receiver never has. A string that is no address is not
   * private.
   */
  public isPrivateAddress(address: string): boolean {
    const bare = address.replace(/^\[|\]$/g, "");
    const v4 = this.parseIPv4(bare);
    if (v4 !== undefined) return this.isPrivateIPv4(v4);
    const v6 = this.parseIPv6(bare);
    if (v6 !== undefined) return this.isPrivateIPv6(v6);
    return false;
  }

  /**
   * IPv4 ranges, as [network, prefix length].
   */
  protected readonly privateIPv4: Array<[string, number]> = [
    ["0.0.0.0", 8], // "this network", unspecified
    ["10.0.0.0", 8], // private
    ["100.64.0.0", 10], // shared (CGNAT), some clouds' metadata
    ["127.0.0.0", 8], // loopback
    ["169.254.0.0", 16], // link-local, cloud metadata (169.254.169.254)
    ["172.16.0.0", 12], // private
    ["192.0.0.0", 24], // IETF protocol assignments
    ["192.0.2.0", 24], // documentation
    ["192.168.0.0", 16], // private
    ["198.18.0.0", 15], // benchmarking
    ["198.51.100.0", 24], // documentation
    ["203.0.113.0", 24], // documentation
    ["224.0.0.0", 4], // multicast
    ["240.0.0.0", 4], // reserved, broadcast
  ];

  protected isPrivateIPv4(value: number): boolean {
    return this.privateIPv4.some(([network, prefix]) => {
      const base = this.parseIPv4(network)!;
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      return (value & mask) >>> 0 === (base & mask) >>> 0;
    });
  }

  protected isPrivateIPv6(groups: number[]): boolean {
    const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
    const embedded = ((g6 << 16) | g7) >>> 0;
    if (groups.every((it) => it === 0)) return true; // ::
    if (groups.slice(0, 7).every((it) => it === 0) && g7 === 1) return true; // ::1
    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d)
    if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0) {
      if (g5 === 0xffff || g5 === 0) return this.isPrivateIPv4(embedded);
    }
    // NAT64 (64:ff9b::a.b.c.d) reaches the embedded IPv4 address.
    if (
      g0 === 0x64 &&
      g1 === 0xff9b &&
      g2 === 0 &&
      g3 === 0 &&
      g4 === 0 &&
      g5 === 0
    ) {
      return this.isPrivateIPv4(embedded);
    }
    if ((g0 & 0xfe00) === 0xfc00) return true; // unique-local fc00::/7
    if ((g0 & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
    if ((g0 & 0xffc0) === 0xfec0) return true; // site-local fec0::/10
    if ((g0 & 0xff00) === 0xff00) return true; // multicast ff00::/8
    if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
    return false;
  }

  /**
   * A dotted-quad IPv4 address as an unsigned integer. The URL parser has
   * already normalised the decimal, octal and hexadecimal spellings.
   */
  protected parseIPv4(text: string): number | undefined {
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
    if (!match) return undefined;
    const parts = match.slice(1).map(Number);
    if (parts.some((it) => it > 255)) return undefined;
    return (
      ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
    );
  }

  /**
   * An IPv6 address as its eight 16-bit groups, `::` and a dotted IPv4 tail
   * understood. A zone (`%eth0`) is dropped.
   */
  protected parseIPv6(text: string): number[] | undefined {
    let source = text.split("%")[0].toLowerCase();
    if (!source.includes(":")) return undefined;
    const tail = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(source);
    if (tail) {
      const v4 = this.parseIPv4(tail[1]);
      if (v4 === undefined) return undefined;
      source = `${source.slice(0, -tail[1].length)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
    }
    const halves = source.split("::");
    if (halves.length > 2) return undefined;
    const head = halves[0] ? halves[0].split(":") : [];
    const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
    const missing = 8 - head.length - rest.length;
    if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
    const groups = [
      ...head,
      ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => "0"),
      ...rest,
    ];
    if (groups.length !== 8) return undefined;
    const values = groups.map((it) =>
      /^[0-9a-f]{1,4}$/.test(it) ? Number.parseInt(it, 16) : Number.NaN,
    );
    return values.some(Number.isNaN) ? undefined : values;
  }
}
