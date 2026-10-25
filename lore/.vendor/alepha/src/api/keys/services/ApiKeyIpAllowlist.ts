/**
 * One entry of an allowlist, in the 128-bit space every address is compared
 * in: the network's first address and how many leading bits must match.
 */
export interface ApiKeyIpRange {
  base: bigint;
  prefix: number;
}

/**
 * Whether a client address is one an API key's allowlist admits.
 *
 * Entries are bare addresses or CIDR ranges, IPv4 and IPv6. No dependency and
 * no `node:net`: this runs inside `ApiKeyService.validate()` on every runtime
 * a key authenticates on, Workers included.
 *
 * ## One address space
 *
 * An IPv4 address is compared as its IPv4-mapped IPv6 form (`::ffff:a.b.c.d`)
 * and an IPv4 prefix as that plus 96. A dual-stack Node server reports an
 * IPv4 client as `::ffff:192.0.2.1`, so an allowlist holding `192.0.2.1` has
 * to match it, and in one space it does without a special case.
 *
 * ## Defensive by construction
 *
 * With `TRUST_PROXY` on (the default) the observed address can be any string
 * a client put in `X-Real-IP`, of any length. Nothing here throws: a value
 * that does not parse is a miss. A throw inside a resolver would be read as
 * "this resolver does not apply" and hand the request to the next one.
 */
export class ApiKeyIpAllowlist {
  /**
   * The longest text worth parsing. The longest valid entry, a full IPv6
   * address with an embedded IPv4 and a prefix, is 49 characters.
   */
  protected readonly maxLength = 64;

  /**
   * The entries that are not a bare address or a CIDR range, in the order
   * given. Empty when every entry is usable.
   */
  public invalidEntries(entries: string[]): string[] {
    return entries.filter((entry) => this.parseRange(entry) === undefined);
  }

  /**
   * Whether `ip` may use a key restricted to `entries`.
   *
   * An empty allowlist admits every caller, an unknown address included: it
   * is what every key without a restriction has. A non-empty one refuses a
   * caller whose address is unknown, so a `validate()` called without an IP
   * fails closed rather than open.
   */
  public allows(entries: string[], ip: string | undefined): boolean {
    if (entries.length === 0) {
      return true;
    }
    if (!ip) {
      return false;
    }

    const address = this.parseObserved(ip);
    if (address === undefined) {
      return false;
    }

    return entries.some((entry) => {
      const range = this.parseRange(entry);
      return range !== undefined && this.contains(range, address);
    });
  }

  /**
   * An entry as a range, or `undefined` when it is not one. A bare address is
   * a `/32` or a `/128`. Host bits set below the prefix are masked away, as
   * every router reads `10.0.0.1/8`.
   */
  public parseRange(entry: string): ApiKeyIpRange | undefined {
    if (typeof entry !== "string" || entry.length > this.maxLength) {
      return undefined;
    }

    const slash = entry.indexOf("/");
    const text = slash === -1 ? entry : entry.slice(0, slash);
    const address = this.parseAddress(text);
    if (!address) {
      return undefined;
    }

    const width = address.version === 4 ? 32 : 128;
    let prefix = width;
    if (slash !== -1) {
      const digits = entry.slice(slash + 1);
      if (!/^\d{1,3}$/.test(digits)) {
        return undefined;
      }
      prefix = Number(digits);
      if (prefix > width) {
        return undefined;
      }
    }

    const total = prefix + (128 - width);
    return { base: this.mask(address.value, total), prefix: total };
  }

  /**
   * The address a request came from, in the shared space. A zone index
   * (`fe80::1%en0`) is dropped: it names an interface, not an address.
   */
  protected parseObserved(ip: string): bigint | undefined {
    if (ip.length > this.maxLength) {
      return undefined;
    }
    const zone = ip.indexOf("%");
    return this.parseAddress(zone === -1 ? ip : ip.slice(0, zone))?.value;
  }

  protected contains(range: ApiKeyIpRange, address: bigint): boolean {
    return this.mask(address, range.prefix) === range.base;
  }

  /**
   * Keep the leading `prefix` bits of a 128-bit value.
   */
  protected mask(value: bigint, prefix: number): bigint {
    const hostBits = BigInt(128 - prefix);
    return (value >> hostBits) << hostBits;
  }

  /**
   * An IPv4 or IPv6 address as a 128-bit value, IPv4 mapped, with the family
   * it was written in (which decides how wide its prefix may be).
   */
  protected parseAddress(
    text: string,
  ): { version: 4 | 6; value: bigint } | undefined {
    const v4 = this.parseIpv4(text);
    if (v4 !== undefined) {
      return { version: 4, value: (0xffffn << 32n) | v4 };
    }
    const v6 = this.parseIpv6(text);
    if (v6 !== undefined) {
      return { version: 6, value: v6 };
    }
    return undefined;
  }

  /**
   * Dotted decimal, four parts of 0 to 255. A leading zero is refused:
   * `010` is ten to some parsers and eight to others.
   */
  protected parseIpv4(text: string): bigint | undefined {
    const parts = text.split(".");
    if (parts.length !== 4) {
      return undefined;
    }

    let value = 0n;
    for (const part of parts) {
      if (!/^\d{1,3}$/.test(part) || (part.length > 1 && part[0] === "0")) {
        return undefined;
      }
      const octet = Number(part);
      if (octet > 255) {
        return undefined;
      }
      value = (value << 8n) | BigInt(octet);
    }
    return value;
  }

  /**
   * Colon-hexadecimal with at most one `::`, and an optional dotted IPv4 in
   * the last 32 bits (`::ffff:192.0.2.1`, `64:ff9b::192.0.2.1`).
   */
  protected parseIpv6(text: string): bigint | undefined {
    if (!text.includes(":") || !/^[0-9a-fA-F:.]+$/.test(text)) {
      return undefined;
    }

    let groups = text;
    const lastColon = text.lastIndexOf(":");
    const tail = text.slice(lastColon + 1);
    if (tail.includes(".")) {
      const v4 = this.parseIpv4(tail);
      if (v4 === undefined) {
        return undefined;
      }
      const high = Number(v4 >> 16n).toString(16);
      const low = Number(v4 & 0xffffn).toString(16);
      groups = `${text.slice(0, lastColon + 1)}${high}:${low}`;
    }

    const halves = groups.split("::");
    if (halves.length > 2) {
      return undefined;
    }

    const head = halves[0] ? halves[0].split(":") : [];
    const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
    const written = [...head, ...rest];
    if (written.some((group) => !/^[0-9a-fA-F]{1,4}$/.test(group))) {
      return undefined;
    }

    // `::` stands for at least one group of zeros.
    if (halves.length === 2 ? written.length > 7 : written.length !== 8) {
      return undefined;
    }

    const zeros = Array(8 - written.length).fill("0");
    const all = [...head, ...zeros, ...rest];
    return all.reduce(
      (value, group) => (value << 16n) | BigInt(`0x${group}`),
      0n,
    );
  }
}
