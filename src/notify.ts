import type { NotificationsConfig, NotifyProviderCfg, BuildContext } from "./config";

export type { BuildContext };

export interface NotifyEvent {
  kind: "start" | "op_complete" | "op_failure" | "complete";
  ctx: BuildContext;
  // start
  ops?: string[];
  // op_complete
  opName?: string;
  opDuration?: number; // ms
  // op_failure
  error?: string;
  // complete
  duration?: number; // ms total
  results?: { op: string; ok: boolean; duration: number }[];
}

export interface NotifyProvider {
  send(event: NotifyEvent): Promise<void>;
}

export class Notifier {
  constructor(
    private providers: NotifyProvider[],
    private flags: Pick<NotificationsConfig, "on_start" | "on_op_complete" | "on_failure" | "on_complete">,
  ) {}

  static fromConfig(cfg: NotificationsConfig | undefined): Notifier {
    const defaultFlags = { on_start: false, on_op_complete: false, on_failure: false, on_complete: false };
    if (!cfg) return new Notifier([], defaultFlags);
    const providers = cfg.providers.map((p) => {
      if (p.type === "wecom") return new WeComProvider(p);
      if (p.type === "telegram") return new TelegramProvider(p);
      throw new Error(`Unknown provider type: ${(p as any).type}`);
    });
    return new Notifier(providers, cfg);
  }

  async fire(event: NotifyEvent): Promise<void> {
    if (event.kind === "start" && !this.flags.on_start) return;
    if (event.kind === "op_complete" && !this.flags.on_op_complete) return;
    if (event.kind === "op_failure" && !this.flags.on_failure) return;
    if (event.kind === "complete" && !this.flags.on_complete) return;

    await Promise.all(
      this.providers.map((p) =>
        p.send(event).catch((e) => {
          console.warn(`[bolt] notify provider failed: ${e?.message ?? e}`);
        }),
      ),
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  if (mins < 60) return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

function ctxHeader(ctx: BuildContext): string {
  const parts = [`**Project:** ${ctx.projectName}`];
  if (ctx.gitBranch) parts.push(`**Branch:** ${ctx.gitBranch}`);
  parts.push(`**ID:** ${ctx.buildId}`);
  return parts.join("  ");
}

// ─── WeCom ────────────────────────────────────────────────────────────────────

type WeComCfg = Extract<NotifyProviderCfg, { type: "wecom" }>;

export class WeComProvider implements NotifyProvider {
  constructor(private cfg: WeComCfg) {}

  buildPayload(event: NotifyEvent): { msgtype: "markdown"; markdown: { content: string } } {
    return { msgtype: "markdown", markdown: { content: this.formatMarkdown(event) } };
  }

  private formatMarkdown(event: NotifyEvent): string {
    const { ctx } = event;
    const header = ctxHeader(ctx);
    const now = new Date(ctx.startTime).toLocaleString("zh-CN", { hour12: false });

    if (event.kind === "start") {
      const plan = (event.ops ?? []).map((op, i) => `> ${i + 1}. ${op}`).join("\n");
      return `## [bolt] Build Started\n${header}\n**Time:** ${now}\n**Plan:**\n${plan}`;
    }

    if (event.kind === "op_complete") {
      const dur = formatDuration(event.opDuration ?? 0);
      return `<font color="info">✅ ${event.opName}</font> — ${dur}`;
    }

    if (event.kind === "op_failure") {
      const dur = formatDuration(event.opDuration ?? 0);
      return `## <font color="warning">❌ ${event.opName} Failed</font>\n${header}\n**Duration:** ${dur}\n**Error:** ${event.error ?? "unknown"}`;
    }

    // complete
    const total = formatDuration(event.duration ?? 0);
    const allOk = (event.results ?? []).every((r) => r.ok);
    const statusColor = allOk ? "info" : "warning";
    const statusIcon = allOk ? "✅" : "❌";
    const rows = (event.results ?? [])
      .map((r) => {
        const icon = r.ok ? `<font color="info">✅</font>` : `<font color="warning">❌</font>`;
        return `> ${icon} ${r.op} (${formatDuration(r.duration)})`;
      })
      .join("\n");
    return `## [bolt] Build <font color="${statusColor}">${statusIcon} ${allOk ? "Complete" : "Failed"}</font>\n${header}\n**Total:** ${total}\n**Results:**\n${rows}`;
  }

  async send(event: NotifyEvent): Promise<void> {
    const payload = this.buildPayload(event);
    const url = this.cfg.webhook_url + (this.cfg.chat_id ? `&chatid=${this.cfg.chat_id}` : "");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`WeCom webhook returned ${res.status}`);
  }
}

// ─── Telegram ─────────────────────────────────────────────────────────────────

type TelegramCfg = Extract<NotifyProviderCfg, { type: "telegram" }>;

export class TelegramProvider implements NotifyProvider {
  constructor(private cfg: TelegramCfg) {}

  buildText(event: NotifyEvent): string {
    const { ctx } = event;
    const header = `*Project:* ${ctx.projectName}${ctx.gitBranch ? `  *Branch:* ${ctx.gitBranch}` : ""}  *ID:* ${ctx.buildId}`;

    if (event.kind === "start") {
      const plan = (event.ops ?? []).map((op, i) => `  ${i + 1}\\. ${op}`).join("\n");
      return `*[bolt] Build Started*\n${header}\n*Plan:*\n${plan}`;
    }

    if (event.kind === "op_complete") {
      return `✅ ${event.opName} — ${formatDuration(event.opDuration ?? 0)}`;
    }

    if (event.kind === "op_failure") {
      return `*[bolt] ❌ ${event.opName} Failed*\n${header}\n*Duration:* ${formatDuration(event.opDuration ?? 0)}\n*Error:* ${event.error ?? "unknown"}`;
    }

    // complete
    const allOk = (event.results ?? []).every((r) => r.ok);
    const rows = (event.results ?? [])
      .map((r) => `  ${r.ok ? "✅" : "❌"} ${r.op} \\(${formatDuration(r.duration)}\\)`)
      .join("\n");
    return `*[bolt] ${allOk ? "✅ Build Complete" : "❌ Build Failed"}*\n${header}\n*Total:* ${formatDuration(event.duration ?? 0)}\n*Results:*\n${rows}`;
  }

  async send(event: NotifyEvent): Promise<void> {
    const text = this.buildText(event);
    const url = `https://api.telegram.org/bot${this.cfg.bot_token}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: this.cfg.chat_id, text, parse_mode: "MarkdownV2" }),
    });
    if (!res.ok) throw new Error(`Telegram API returned ${res.status}`);
  }
}
