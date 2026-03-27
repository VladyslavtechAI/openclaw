/**
 * Network policy enforcement for agents.
 * Blocks SSRF, internal network access, and unauthorized outbound traffic.
 */

import { RESTRICTED_NETWORKS } from "./injection-patterns.js";

export type NetworkCapabilities = {
  web_fetch: boolean;
  web_search: boolean;
  exec_curl: boolean;
  exec_ssh: boolean;
  raw_sockets: boolean;
};

export type UrlCheckResult = {
  allowed: boolean;
  reason?: string;
  restrictedNetwork?: string;
};

/**
 * Parse IP from URL hostname.
 */
function extractHostFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return undefined;
  }
}

/**
 * Convert IP to numeric for CIDR matching.
 */
function ipToNumber(ip: string): number | undefined {
  const parts = ip.split(".");
  if (parts.length !== 4) return undefined;
  const nums = parts.map(Number);
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return undefined;
  return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
}

/**
 * Check if IP falls within a CIDR range.
 */
function isIpInCidr(ip: string, cidr: string): boolean {
  // Skip IPv6 for now
  if (cidr.includes(":")) return false;

  const [network, maskStr] = cidr.split("/");
  const mask = Number(maskStr);
  const ipNum = ipToNumber(ip);
  const netNum = ipToNumber(network);

  if (ipNum === undefined || netNum === undefined) return false;

  const maskBits = mask === 0 ? 0 : (~0 << (32 - mask)) >>> 0;
  return (ipNum & maskBits) === (netNum & maskBits);
}

export class NetworkPolicy {
  private urlWhitelist: string[];
  private urlBlacklist: string[];

  constructor(config: { urlWhitelist?: string[]; urlBlacklist?: string[] } = {}) {
    this.urlWhitelist = config.urlWhitelist ?? [];
    this.urlBlacklist = config.urlBlacklist ?? [];
  }

  /**
   * Check if a URL is allowed for agent access.
   */
  checkUrl(url: string): UrlCheckResult {
    const host = extractHostFromUrl(url);
    if (!host) {
      return { allowed: false, reason: "Invalid URL" };
    }

    // Check restricted networks (SSRF protection)
    for (const network of RESTRICTED_NETWORKS) {
      if (isIpInCidr(host, network.cidr)) {
        return {
          allowed: false,
          reason: `Blocked: ${network.name} (${network.cidr})`,
          restrictedNetwork: network.name,
        };
      }
    }

    // Check special hostnames
    if (host === "localhost" || host === "0.0.0.0") {
      return { allowed: false, reason: "Blocked: localhost", restrictedNetwork: "loopback" };
    }

    // Check for metadata endpoints (AWS/GCP/Azure)
    if (host === "metadata.google.internal" || host === "metadata.google.com") {
      return { allowed: false, reason: "Blocked: cloud metadata", restrictedNetwork: "cloud_metadata" };
    }

    // Check blacklist
    for (const blocked of this.urlBlacklist) {
      if (host === blocked || host.endsWith(`.${blocked}`)) {
        return { allowed: false, reason: `Blocked by blacklist: ${blocked}` };
      }
    }

    // Check whitelist (if configured, only allow listed domains)
    if (this.urlWhitelist.length > 0) {
      const isWhitelisted = this.urlWhitelist.some(
        (w) => host === w || host.endsWith(`.${w}`),
      );
      if (!isWhitelisted) {
        return { allowed: false, reason: `Not in whitelist: ${host}` };
      }
    }

    return { allowed: true };
  }

  /**
   * Check if an exec command contains blocked network operations.
   */
  checkExecCommand(command: string): UrlCheckResult {
    // Block network scanning
    if (/\b(nmap|masscan|zmap)\b/i.test(command)) {
      return { allowed: false, reason: "Blocked: network scanning tool" };
    }

    // Block raw socket tools (unless specifically allowed)
    if (/\b(nc|ncat|netcat|socat|telnet)\b/i.test(command)) {
      return { allowed: false, reason: "Blocked: raw socket tool" };
    }

    // Extract URLs from curl/wget commands and check them
    const urlMatch = command.match(/(?:curl|wget)\s+.*?(https?:\/\/\S+)/i);
    if (urlMatch) {
      return this.checkUrl(urlMatch[1]);
    }

    return { allowed: true };
  }

  /**
   * Get network capabilities for an agent based on hierarchy level.
   */
  getCapabilities(hierarchyLevel: number): NetworkCapabilities {
    return {
      web_fetch: true, // Controlled by URL policy
      web_search: true, // Safe (goes through API)
      exec_curl: hierarchyLevel <= 1, // Only admin/lead
      exec_ssh: hierarchyLevel === 0, // Only admin
      raw_sockets: false, // Never
    };
  }
}
