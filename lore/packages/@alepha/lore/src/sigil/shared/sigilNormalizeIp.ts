/**
 * The address a visitor hash closes over, normalised.
 *
 * - IPv4 is kept as it is.
 * - An IPv4-mapped IPv6 address (`::ffff:1.2.3.4`) is read as the IPv4 it is.
 * - Any other IPv6 address is cut to its /64 (`2001:db8:0:1::/64`): one
 *   household or one phone gets a whole /64 and rotates the lower half on
 *   its own (privacy extensions), so the full address would count one
 *   person as several visitors in a day.
 *
 * Brackets and a zone id (`%eth0`) are dropped. Anything that is not an
 * address comes back lowercased and trimmed, so the hash stays defined.
 */
export const sigilNormalizeIp = (raw: string): string => {
  let ip = raw.trim().toLowerCase();
  if (ip.startsWith("[") && ip.includes("]")) {
    ip = ip.slice(1, ip.indexOf("]"));
  }
  const zone = ip.indexOf("%");
  if (zone >= 0) ip = ip.slice(0, zone);
  if (!ip.includes(":")) return ip;

  const groups = sigilExpandIpv6(ip);
  if (!groups) return ip;
  const values = groups.map((group) => Number.parseInt(group, 16));
  if (
    values.slice(0, 5).every((value) => value === 0) &&
    values[5] === 0xffff
  ) {
    return [
      values[6] >> 8,
      values[6] & 255,
      values[7] >> 8,
      values[7] & 255,
    ].join(".");
  }
  const prefix = groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ""))
    .join(":");
  return `${prefix}::/64`;
};

/**
 * The eight hextets of an IPv6 address, `::` expanded, or `undefined` when
 * the text is not one. A trailing dotted IPv4 counts as two hextets.
 */
const sigilExpandIpv6 = (ip: string): string[] | undefined => {
  let text = ip;
  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (dotted) {
    const octets = dotted[1].split(".").map(Number);
    if (octets.some((octet) => octet > 255)) return undefined;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    text = `${text.slice(0, -dotted[1].length)}${high}:${low}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const groups = [
    ...head,
    ...Array(halves.length === 2 ? missing : 0).fill("0"),
    ...tail,
  ];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) {
    return undefined;
  }
  return groups;
};
