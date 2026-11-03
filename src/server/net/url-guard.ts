/**
 * SSRF guard for operator-supplied outbound URLs (decision webhook).
 *
 * One module is shared by both call sites so the rules cannot drift:
 * - `assertWebhookUrlSyntax` — synchronous parse + scheme + literal-address
 *   checks, used when the owner updates the webhook URL.
 * - `assertWebhookUrlSafe` — syntax plus DNS resolution, every resolved
 *   address classified; used right before delivering.
 *
 * The classification covers the ranges that matter for SSRF: loopback, RFC1918,
 * link-local (incl. 169.254.169.254 metadata), CGNAT, this-host, multicast and
 * reserved IPv4; IPv6 loopback/unspecified/ULA/link-local/multicast, plus
 * IPv4-mapped and NAT64 wrappers around those IPv4 ranges. Non-canonical IPv4
 * notations (decimal, octal, hex, short form) are already normalized by the
 * WHATWG URL parser, so the literal check sees the real address.
 */
import { lookup as dnsLookup } from 'node:dns/promises';

export interface AddressRecord {
  address: string;
  family?: number;
}

export interface UrlGuardOptions {
  /** Opt-in for local receivers (dev / tests). Fail-closed by default. */
  allowPrivateHosts?: boolean;
  /** Injection seam for tests; defaults to node:dns lookup with all records. */
  lookup?: (host: string) => Promise<AddressRecord[]>;
  timeoutMs?: number;
}

export const DEFAULT_URL_GUARD_TIMEOUT_MS = 3_000;

type Ipv4 = [number, number, number, number];
type Ipv6 = [number, number, number, number, number, number, number, number];

function parseIpv4(value: string): Ipv4 | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
  return octets as Ipv4;
}

function toGroups(segment: string): number[] | null {
  if (!segment) return [];
  const parts = segment.split(':');
  const groups: number[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] as string;
    if (index === parts.length - 1 && part.includes('.')) {
      const embedded = parseIpv4(part);
      if (!embedded) return null;
      groups.push((embedded[0] << 8) | embedded[1], (embedded[2] << 8) | embedded[3]);
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    groups.push(Number.parseInt(part, 16));
  }
  return groups.length > 8 ? null : groups;
}

function expandIpv6(value: string): Ipv6 | null {
  const halves = value.split('::');
  if (halves.length > 2) return null;
  if (halves.length === 1) {
    const groups = toGroups(value);
    return groups && groups.length === 8 ? (groups as Ipv6) : null;
  }
  const head = toGroups(halves[0] as string);
  const tail = toGroups(halves[1] as string);
  if (!head || !tail) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const merged = [...head, ...new Array<number>(missing).fill(0), ...tail];
  return merged.length === 8 ? (merged as Ipv6) : null;
}

function embedIpv4(groups: Ipv6): Ipv4 {
  return [groups[6] >> 8 & 0xff, groups[6] & 0xff, groups[7] >> 8 & 0xff, groups[7] & 0xff];
}

function classifyIpv4([a, b, c]: Ipv4): string | null {
  if (a === 0) return 'this-host 0.0.0.0/8';
  if (a === 10) return 'private 10/8';
  if (a === 127) return 'loopback 127/8';
  if (a === 100 && b >= 64 && b <= 127) return 'CGNAT 100.64/10';
  if (a === 169 && b === 254) return 'link-local 169.254/16';
  if (a === 172 && b >= 16 && b <= 31) return 'private 172.16/12';
  if (a === 192 && b === 168) return 'private 192.168/16';
  if (a === 192 && b === 0 && c === 0) return 'reserved 192.0.0/24';
  if (a === 192 && b === 0 && c === 2) return 'documentation 192.0.2/24';
  if (a === 198 && (b === 18 || b === 19)) return 'benchmark 198.18/15';
  if (a === 198 && b === 51 && c === 100) return 'documentation 198.51.100/24';
  if (a === 203 && b === 0 && c === 113) return 'documentation 203.0.113/24';
  if (a >= 224 && a <= 239) return 'multicast 224/4';
  if (a >= 240) return 'reserved 240/4';
  return null;
}

function classifyIpv6(groups: Ipv6): string | null {
  if (groups.every((group) => group === 0)) return 'unspecified address ::';
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return 'loopback ::1';
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return classifyIpv4(embedIpv4(groups)) ?? null;
  }
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((group) => group === 0)) {
    return classifyIpv4(embedIpv4(groups)) ?? 'NAT64 64:ff9b::/96';
  }
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups[2] === 1) return 'NAT64 local-use 64:ff9b:1::/48';
  if ((groups[0] & 0xfe00) === 0xfc00) return 'unique-local fc00::/7';
  if ((groups[0] & 0xffc0) === 0xfe80) return 'link-local fe80::/10';
  if ((groups[0] & 0xff00) === 0xff00) return 'multicast ff00::/8';
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return 'documentation 2001:db8::/32';
  if (groups[0] === 0x2002) return '6to4 2002::/16';
  return null;
}

/** Returns a short reason when the address is not public unicast, else null. */
export function classifyAddress(rawAddress: string): string | null {
  const address = rawAddress
    .trim()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split('%')[0]
    ?.toLowerCase();
  if (!address) return 'empty address';
  const ipv4 = parseIpv4(address);
  if (ipv4) return classifyIpv4(ipv4);
  const ipv6 = expandIpv6(address);
  if (!ipv6) return 'unparsable address';
  return classifyIpv6(ipv6);
}

function stripBrackets(hostname: string): string {
  return hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}

function looksLikeAddress(host: string): boolean {
  return host.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

function parseHttpUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('webhookUrl must be an absolute URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('webhookUrl must use http or https');
  }
  if (!stripBrackets(parsed.hostname)) throw new Error('webhookUrl must include a host');
  return parsed;
}

/**
 * Parse-time guard: rejects non-http(s) URLs, localhost names and literal
 * addresses in any non-public range. No DNS involved, so it is safe to run
 * synchronously on config writes. `allowPrivateHosts` is the explicit dev
 * opt-in for loopback receivers; it still enforces scheme and host presence.
 */
export function assertWebhookUrlSyntax(raw: string, options: UrlGuardOptions = {}): URL {
  const parsed = parseHttpUrl(raw);
  if (options.allowPrivateHosts) return parsed;
  const host = stripBrackets(parsed.hostname);
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('webhookUrl must not target localhost');
  }
  if (looksLikeAddress(host)) {
    const reason = classifyAddress(host);
    if (reason) throw new Error(`webhookUrl must not target a non-public address (${reason})`);
  }
  return parsed;
}

async function resolveHost(host: string, options: UrlGuardOptions): Promise<AddressRecord[]> {
  const lookup = options.lookup ?? ((name: string) => dnsLookup(name, { all: true, verbatim: true }));
  const timeoutMs = options.timeoutMs ?? DEFAULT_URL_GUARD_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookup(host),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('webhookUrl DNS resolution timed out')),
          timeoutMs,
        );
        (timer as { unref?: () => void }).unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Delivery-time guard: syntax plus DNS, then classify every resolved record.
 * Any non-public answer rejects the whole URL (mixed answers are not trusted).
 */
export async function assertWebhookUrlSafe(raw: string, options: UrlGuardOptions = {}): Promise<URL> {
  const parsed = assertWebhookUrlSyntax(raw, options);
  if (options.allowPrivateHosts) return parsed;
  const host = stripBrackets(parsed.hostname);
  if (looksLikeAddress(host)) return parsed;
  const records = await resolveHost(host, options);
  if (records.length === 0) throw new Error(`webhookUrl host ${host} did not resolve`);
  for (const record of records) {
    const reason = classifyAddress(record.address);
    if (reason) {
      throw new Error(`webhookUrl must not target a non-public address (${reason} via ${host})`);
    }
  }
  return parsed;
}
