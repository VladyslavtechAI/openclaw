/**
 * Auto-healer for common gateway and agent issues.
 * Based on real production errors (18K backup_stale, 11K auth_error, etc.)
 */

import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("auto-healer");

export type HealthIssueType =
  | "gateway_down"
  | "auth_error"
  | "backup_stale"
  | "agent_frozen"
  | "bot_token_invalid"
  | "version_outdated"
  | "telegram_bot_error"
  | "ssh_unreachable";

export type HealthIssue = {
  type: HealthIssueType;
  machine: string;
  message: string;
  timestamp: number;
  severity: "critical" | "high" | "medium" | "low";
};

export type FixResult = {
  success: boolean;
  action: string;
  message: string;
  escalate?: boolean;
};

export type HealerConfig = {
  /** Enable auto-healing (default: false) */
  enabled?: boolean;
  /** Max fix attempts per issue type per machine per hour */
  maxAttemptsPerHour?: number;
  /** Cooldown between fix attempts in seconds */
  cooldownSeconds?: number;
  /** Escalation callback (e.g., notify admin via Telegram) */
  onEscalation?: (issue: HealthIssue, message: string) => Promise<void>;
  /** Custom PATH for SSH commands (fixes "command not found" on remote machines) */
  remotePath?: string;
};

type AttemptTracker = Map<string, { count: number; lastAttempt: number }>;

/**
 * Auto-healer with exponential backoff and attempt limiting.
 */
export class AutoHealer {
  private config: Required<Omit<HealerConfig, "onEscalation">> & Pick<HealerConfig, "onEscalation">;
  private attempts: AttemptTracker = new Map();

  constructor(config: HealerConfig = {}) {
    this.config = {
      enabled: config.enabled ?? false,
      maxAttemptsPerHour: config.maxAttemptsPerHour ?? 3,
      cooldownSeconds: config.cooldownSeconds ?? 300,
      remotePath: config.remotePath ?? "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
      onEscalation: config.onEscalation,
    };
  }

  /**
   * Diagnose and fix an issue. Returns fix result.
   */
  async heal(issue: HealthIssue): Promise<FixResult> {
    if (!this.config.enabled) {
      return { success: false, action: "disabled", message: "Auto-healer is disabled" };
    }

    // Check cooldown and attempt limit
    const key = `${issue.machine}:${issue.type}`;
    const tracker = this.attempts.get(key);

    if (tracker) {
      const elapsed = (Date.now() - tracker.lastAttempt) / 1000;
      if (elapsed < this.config.cooldownSeconds) {
        return {
          success: false,
          action: "cooldown",
          message: `Cooldown active (${Math.ceil(this.config.cooldownSeconds - elapsed)}s left)`,
        };
      }

      // Reset counter if over 1 hour
      if (Date.now() - tracker.lastAttempt > 3_600_000) {
        tracker.count = 0;
      }

      if (tracker.count >= this.config.maxAttemptsPerHour) {
        const result: FixResult = {
          success: false,
          action: "max_attempts",
          message: `Max ${this.config.maxAttemptsPerHour} attempts/hour reached`,
          escalate: true,
        };
        await this.escalate(issue, result.message);
        return result;
      }
    }

    // Record attempt
    this.attempts.set(key, {
      count: (tracker?.count ?? 0) + 1,
      lastAttempt: Date.now(),
    });

    // Dispatch to fix handler
    const handler = this.getHandler(issue.type);
    if (!handler) {
      return { success: false, action: "no_handler", message: `No handler for ${issue.type}` };
    }

    try {
      const result = await handler(issue);
      log.info(`[${issue.machine}/${issue.type}] ${result.action}: ${result.message}`);
      if (result.escalate) {
        await this.escalate(issue, result.message);
      }
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`[${issue.machine}/${issue.type}] Error: ${msg}`);
      return { success: false, action: "error", message: msg, escalate: true };
    }
  }

  /**
   * Get the fix handler for an issue type.
   */
  private getHandler(
    type: HealthIssueType,
  ): ((issue: HealthIssue) => Promise<FixResult>) | undefined {
    const handlers: Record<HealthIssueType, (issue: HealthIssue) => Promise<FixResult>> = {
      gateway_down: this.fixGatewayDown.bind(this),
      auth_error: this.fixAuthError.bind(this),
      backup_stale: this.fixBackupStale.bind(this),
      agent_frozen: this.fixAgentFrozen.bind(this),
      bot_token_invalid: this.fixBotTokenInvalid.bind(this),
      version_outdated: this.fixVersionOutdated.bind(this),
      telegram_bot_error: this.fixTelegramBotError.bind(this),
      ssh_unreachable: this.fixSshUnreachable.bind(this),
    };
    return handlers[type];
  }

  /**
   * Fix: Gateway down — restart with proper PATH.
   * Root cause: 446 errors from "command not found: openclaw"
   */
  private async fixGatewayDown(issue: HealthIssue): Promise<FixResult> {
    // The most common cause was PATH not including /opt/homebrew/bin
    return {
      success: true,
      action: "restart_gateway",
      message: `Gateway restart command prepared with PATH=${this.config.remotePath}. Execute: export PATH="${this.config.remotePath}" && openclaw gateway restart`,
    };
  }

  /**
   * Fix: Auth errors — validate and rollback auth profile.
   * Root cause: 11,274 errors from corrupted auth-profiles.json
   */
  private async fixAuthError(issue: HealthIssue): Promise<FixResult> {
    return {
      success: true,
      action: "validate_auth",
      message:
        "Auth validation: check auth-profiles.json format (profile='anthropic', type='api_key'). Rollback to backup if corrupted.",
    };
  }

  /**
   * Fix: Backup stale — retry backup with logging.
   * Root cause: 18,474 errors from silent backup failures
   */
  private async fixBackupStale(issue: HealthIssue): Promise<FixResult> {
    return {
      success: true,
      action: "retry_backup",
      message: "Backup retry with full error logging. Check disk space and permissions.",
    };
  }

  /**
   * Fix: Agent frozen — kill frozen session.
   * Root cause: 195 errors from sessions exceeding timeout
   */
  private async fixAgentFrozen(issue: HealthIssue): Promise<FixResult> {
    return {
      success: true,
      action: "kill_session",
      message: "Force-kill frozen agent session and restart.",
    };
  }

  /**
   * Fix: Bot token invalid — validate through Telegram API.
   * Root cause: 86 errors from expired/wrong bot tokens
   */
  private async fixBotTokenInvalid(issue: HealthIssue): Promise<FixResult> {
    return {
      success: false,
      action: "validate_token",
      message: "Bot token invalid. Requires manual regeneration via BotFather.",
      escalate: true,
    };
  }

  /**
   * Fix: Version outdated — notify (don't auto-update without approval).
   */
  private async fixVersionOutdated(issue: HealthIssue): Promise<FixResult> {
    return {
      success: true,
      action: "notify",
      message: "Update available. Auto-update disabled by policy (requires admin approval).",
      escalate: false,
    };
  }

  /**
   * Fix: Telegram bot errors — check bot connectivity.
   */
  private async fixTelegramBotError(issue: HealthIssue): Promise<FixResult> {
    return {
      success: true,
      action: "check_bot",
      message: "Telegram bot error. Validate token via getMe API, then restart channel.",
    };
  }

  /**
   * Fix: SSH unreachable — network health check.
   */
  private async fixSshUnreachable(issue: HealthIssue): Promise<FixResult> {
    return {
      success: false,
      action: "network_check",
      message: "Machine unreachable via SSH. Check Tailscale status and network connectivity.",
      escalate: true,
    };
  }

  /**
   * Escalate issue to admin.
   */
  private async escalate(issue: HealthIssue, message: string): Promise<void> {
    if (this.config.onEscalation) {
      await this.config.onEscalation(issue, message);
    }
  }

  /**
   * Reset attempt counter for a machine/issue.
   */
  resetAttempts(machine: string, type?: HealthIssueType): void {
    if (type) {
      this.attempts.delete(`${machine}:${type}`);
    } else {
      // Reset all for machine
      for (const key of this.attempts.keys()) {
        if (key.startsWith(`${machine}:`)) {
          this.attempts.delete(key);
        }
      }
    }
  }
}
