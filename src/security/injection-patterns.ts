/**
 * Known prompt injection attack patterns database.
 * Updated regularly from OWASP LLM Top 10, research papers, and production data.
 */

export type InjectionPattern = {
  name: string;
  pattern: RegExp;
  severity: number; // 0.1-0.5
  category: "direct" | "indirect" | "encoded" | "structural" | "exfiltration" | "jailbreak";
};

export const INJECTION_PATTERNS: InjectionPattern[] = [
  // === Direct Injection ===
  { name: "ignore_instructions", pattern: /ignore\s+(all\s+)?previous\s+instructions/i, severity: 0.5, category: "direct" },
  { name: "forget_everything", pattern: /forget\s+(everything|all|your)\s+(above|previous)/i, severity: 0.5, category: "direct" },
  { name: "disregard_rules", pattern: /\bdisregard\b.*\b(rules|instructions|guidelines|constraints)\b/i, severity: 0.5, category: "direct" },
  { name: "ignore_safety", pattern: /\bignore\b.*\b(safety|security|rules?|guidelines?)\b/i, severity: 0.4, category: "direct" },
  { name: "new_instructions", pattern: /\bnew\s+instructions?\b.*:?\s*\bfollow/i, severity: 0.4, category: "direct" },
  { name: "you_are_now", pattern: /you\s+are\s+now\s+(a|an|the)\s/i, severity: 0.3, category: "direct" },
  { name: "act_as", pattern: /\bact\s+as\s+(a|an|if)\b/i, severity: 0.2, category: "direct" },
  { name: "pretend_to_be", pattern: /\bpretend\s+(to\s+be|you('re|\s+are))\b/i, severity: 0.3, category: "direct" },
  { name: "override_system", pattern: /\boverride\s+(your\s+)?(system|core|safety|security)\b/i, severity: 0.5, category: "direct" },
  { name: "reveal_prompt", pattern: /\b(reveal|show|display|print|output)\s+(your\s+)?(system\s+)?prompt\b/i, severity: 0.4, category: "direct" },

  // === Structural Injection (role confusion) ===
  { name: "system_tag", pattern: /\[SYSTEM\]/i, severity: 0.4, category: "structural" },
  { name: "inst_tag", pattern: /\[INST\]/i, severity: 0.4, category: "structural" },
  { name: "im_start_system", pattern: /<\|im_start\|>system/i, severity: 0.5, category: "structural" },
  { name: "im_end", pattern: /<\|im_end\|>/i, severity: 0.3, category: "structural" },
  { name: "claude_role", pattern: /\n\s*(Human|Assistant)\s*:/m, severity: 0.3, category: "structural" },
  { name: "xml_system", pattern: /<system>/i, severity: 0.4, category: "structural" },
  { name: "separator_injection", pattern: /---+\s*\n\s*(system|instruction|role)/im, severity: 0.3, category: "structural" },

  // === Encoded Injection ===
  { name: "base64_ignore", pattern: /aWdub3JlIHByZXZpb3Vz/i, severity: 0.5, category: "encoded" },
  { name: "base64_system", pattern: /c3lzdGVtIHByb21wdA==/i, severity: 0.4, category: "encoded" },
  { name: "html_entity_injection", pattern: /&#x[0-9a-f]{2};&#x[0-9a-f]{2};&#x[0-9a-f]{2};&#x[0-9a-f]{2};/i, severity: 0.3, category: "encoded" },
  { name: "unicode_rtl", pattern: /[\u200F\u200E\u202A-\u202E\u2066-\u2069]/u, severity: 0.4, category: "encoded" },
  { name: "zero_width_chars", pattern: /[\u200B\u200C\u200D\uFEFF]{3,}/u, severity: 0.3, category: "encoded" },
  { name: "homoglyph_a", pattern: /[\u0430\u0410]/, severity: 0.2, category: "encoded" }, // Cyrillic а/А

  // === Exfiltration Attempts ===
  { name: "send_data", pattern: /send\s+(this|the|all|my)\s+(data|info|key|token|secret|password|credential)/i, severity: 0.5, category: "exfiltration" },
  { name: "exfiltrate", pattern: /\b(exfiltrate|leak|extract|steal|dump)\s+(the|my|all|every)/i, severity: 0.5, category: "exfiltration" },
  { name: "post_to_url", pattern: /\b(post|upload|transmit|transfer)\s+.*\bto\s+https?:\/\//i, severity: 0.4, category: "exfiltration" },
  { name: "read_ssh_key", pattern: /\bread\s+.*\.(ssh|gnupg|pem|key|p12|pfx)\b/i, severity: 0.4, category: "exfiltration" },
  { name: "read_env_secrets", pattern: /\b(env|environ|\.env|process\.env)\b.*\b(key|secret|token|password)\b/i, severity: 0.3, category: "exfiltration" },

  // === Jailbreak Patterns ===
  { name: "dan_mode", pattern: /\bDAN\s*(mode|prompt)?\b/i, severity: 0.4, category: "jailbreak" },
  { name: "developer_mode", pattern: /developer\s+mode\s+(enabled|on|activated|unlocked)/i, severity: 0.4, category: "jailbreak" },
  { name: "jailbreak", pattern: /\bjailbreak(ed|ing)?\b/i, severity: 0.3, category: "jailbreak" },
  { name: "do_anything_now", pattern: /\bdo\s+anything\s+now\b/i, severity: 0.4, category: "jailbreak" },
  { name: "no_restrictions", pattern: /\b(without|no|remove|disable)\s+(all\s+|any\s+)?(restrictions?|limitations?|filters?|guardrails?)\b/i, severity: 0.4, category: "jailbreak" },
  { name: "hypothetical_bypass", pattern: /\b(hypothetically|theoretically|in\s+theory)\b.*\b(how\s+would|could\s+you)\b/i, severity: 0.2, category: "jailbreak" },
];

/**
 * Exfiltration command patterns for exec analysis.
 */
export type ExecExfilPattern = {
  name: string;
  pattern: RegExp;
  confidence: number; // 0-1
  category: "http" | "netcat" | "file_transfer" | "script" | "pipe" | "dns";
};

export const EXEC_EXFIL_PATTERNS: ExecExfilPattern[] = [
  // HTTP exfiltration
  { name: "curl_post", pattern: /curl\s+.*-(d|X\s*POST|X\s*PUT|--data)/i, confidence: 0.8, category: "http" },
  { name: "wget_post", pattern: /wget\s+.*--post/i, confidence: 0.8, category: "http" },
  { name: "curl_upload", pattern: /curl\s+.*(-F|--upload-file)/i, confidence: 0.7, category: "http" },

  // Netcat
  { name: "netcat_outbound", pattern: /\b(nc|ncat|netcat)\b.*\d+\.\d+\.\d+\.\d+/i, confidence: 0.9, category: "netcat" },
  { name: "netcat_pipe", pattern: /\|\s*(nc|ncat|netcat)\b/i, confidence: 0.9, category: "netcat" },

  // File transfer
  { name: "scp_remote", pattern: /\bscp\b.*@.*:/i, confidence: 0.7, category: "file_transfer" },
  { name: "rsync_remote", pattern: /\brsync\b.*@/i, confidence: 0.7, category: "file_transfer" },
  { name: "sftp_remote", pattern: /\bsftp\b.*@/i, confidence: 0.7, category: "file_transfer" },

  // Script-based exfil
  { name: "python_requests", pattern: /python.*requests\.(post|put|patch)/i, confidence: 0.8, category: "script" },
  { name: "python_urllib", pattern: /python.*urllib\.request\.(urlopen|Request)/i, confidence: 0.7, category: "script" },
  { name: "node_fetch", pattern: /node.*fetch\(|axios\.(post|put)/i, confidence: 0.8, category: "script" },
  { name: "ruby_net_http", pattern: /ruby.*Net::HTTP\.(post|put)/i, confidence: 0.7, category: "script" },

  // Pipe chains
  { name: "pipe_to_curl", pattern: /\|\s*curl\b/i, confidence: 0.9, category: "pipe" },
  { name: "pipe_to_wget", pattern: /\|\s*wget\b/i, confidence: 0.8, category: "pipe" },
  { name: "pipe_to_ssh", pattern: /\|\s*ssh\b/i, confidence: 0.8, category: "pipe" },

  // DNS exfiltration
  { name: "dns_exfil_dig", pattern: /\bdig\b.*\$\(/i, confidence: 0.85, category: "dns" },
  { name: "dns_exfil_nslookup", pattern: /\bnslookup\b.*\$\(/i, confidence: 0.85, category: "dns" },
  { name: "dns_exfil_host", pattern: /\bhost\b.*\$\(/i, confidence: 0.75, category: "dns" },
];

/**
 * Backdoor patterns for workspace/config file scanning.
 */
export type BackdoorPattern = {
  name: string;
  pattern: RegExp;
  severity: "critical" | "high" | "medium" | "low";
  fileTypes: string[]; // which files to scan
};

export const BACKDOOR_PATTERNS: BackdoorPattern[] = [
  // Workspace file backdoors
  { name: "secret_exfil_instruction", pattern: /\b(always|secretly|quietly)\s+(send|forward|copy|transmit)\b/i, severity: "critical", fileTypes: [".md"] },
  { name: "concealment", pattern: /\bdon'?t\s+tell\s+(the\s+)?(user|owner|operator|human|admin)/i, severity: "critical", fileTypes: [".md"] },
  { name: "security_bypass", pattern: /\b(bypass|disable|ignore|skip)\s+.*\b(security|safety|auth|approval)/i, severity: "critical", fileTypes: [".md", ".json"] },
  { name: "hidden_instruction", pattern: /<!--.*(?:ignore|override|bypass|secret).*-->/is, severity: "high", fileTypes: [".md", ".html"] },
  { name: "remote_code_exec", pattern: /curl\s+.*\|\s*(sh|bash|zsh|python)/i, severity: "critical", fileTypes: [".md", ".sh"] },
  { name: "eval_injection", pattern: /\beval\s*\(.*\$/, severity: "high", fileTypes: [".sh", ".js", ".ts"] },

  // Config backdoors
  { name: "open_access", pattern: /"allowFrom"\s*:\s*"\*"/i, severity: "critical", fileTypes: [".json"] },
  { name: "unrestricted_exec", pattern: /"security"\s*:\s*"full"/i, severity: "critical", fileTypes: [".json"] },
  { name: "disabled_auth", pattern: /"auth"\s*:\s*(false|null|"")/i, severity: "critical", fileTypes: [".json"] },
  { name: "wildcard_tools", pattern: /"allow"\s*:\s*\["\*"\]/i, severity: "high", fileTypes: [".json"] },

  // SSH/persistence
  { name: "ssh_key_injection", pattern: /ssh-(rsa|ed25519|ecdsa)\s+AAAA/i, severity: "high", fileTypes: ["authorized_keys"] },
  { name: "crontab_injection", pattern: /\*\s+\*\s+\*\s+\*\s+\*\s+(curl|wget|nc|python|node|bash|sh)\b/i, severity: "critical", fileTypes: ["crontab", ".sh"] },
];

/**
 * Internal/restricted network ranges for SSRF protection.
 */
export const RESTRICTED_NETWORKS = [
  { name: "loopback_v4", cidr: "127.0.0.0/8" },
  { name: "private_10", cidr: "10.0.0.0/8" },
  { name: "private_172", cidr: "172.16.0.0/12" },
  { name: "private_192", cidr: "192.168.0.0/16" },
  { name: "tailscale", cidr: "100.64.0.0/10" },
  { name: "link_local", cidr: "169.254.0.0/16" }, // Cloud metadata
  { name: "loopback_v6", cidr: "::1/128" },
  { name: "unique_local_v6", cidr: "fd00::/8" },
  { name: "link_local_v6", cidr: "fe80::/10" },
];
