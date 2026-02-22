import type { NotificationsConfig, NotifyProviderCfg } from "./config";

export interface NotifyEvent {
  kind: "start" | "complete" | "failure";
  ops?: string[];
  opName?: string;
  duration?: number; // ms
  results?: { op: string; ok: boolean }[];
  error?: string;
}

export interface NotifyProvider {
  send(event: NotifyEvent): Promise<void>;
}

export class Notifier {
  constructor(private providers: NotifyProvider[]) {}

  static fromConfig(cfg: NotificationsConfig | undefined): Notifier {
    if (!cfg) return new Notifier([]);
    return new Notifier(
      cfg.providers.map((p) => {
        if (p.type === "wecom") return new WeComProvider(p);
        if (p.type === "telegram") return new TelegramProvider(p);
        throw new Error(`Unknown provider type: ${(p as any).type}`);
      }),
    );
  }

  async fire(event: NotifyEvent): Promise<void> {
    await Promise.all(
      this.providers.map((p) =>
        p.send(event).catch((e) => {
          console.warn(`[bolt] notify provider failed: ${e?.message ?? e}`);
        }),
      ),
    );
  }
}

// ─── WeCom ────────────────────────────────────────────────────────────────────

type WeComCfg = Extract<NotifyProviderCfg, { type: "wecom" }>;

export class WeComProvider implements NotifyProvider {
  constructor(private cfg: WeComCfg) {}

  buildPayload(event: NotifyEvent): { msgtype: "markdown"; markdown: { content: string } } {
    return { msgtype: "markdown", markdown: { content: this.formatMarkdown(event) } };
  }

  private formatMarkdown(event: NotifyEvent): string {
    if (event.kind === "start") {
      const ops = event.ops?.join(" → ") ?? "";
      return `**[bolt] Build started**\nOps: ${ops}`;
    }
    if (event.kind === "failure") {
      return `**[bolt] ❌ ${event.opName} FAILED**\nError: ${event.error ?? "unknown"}`;
    }
    const secs = Math.floor((event.duration ?? 0) / 1000);
    const summary = (event.results ?? []).map((r) => `${r.op} ${r.ok ? "✅" : "❌"}`).join(" | ");
    return `**[bolt] ✅ Done in ${secs}s**\n${summary}`;
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
    if (event.kind === "start") {
      const ops = event.ops?.join(" → ") ?? "";
      return `*[bolt] Build started*\nOps: ${ops}`;
    }
    if (event.kind === "failure") {
      return `*[bolt] ❌ ${event.opName} FAILED*\nError: ${event.error ?? "unknown"}`;
    }
    const secs = Math.floor((event.duration ?? 0) / 1000);
    const summary = (event.results ?? []).map((r) => `${r.op} ${r.ok ? "✅" : "❌"}`).join(" | ");
    return `*[bolt] ✅ Done in ${secs}s*\n${summary}`;
  }

  async send(event: NotifyEvent): Promise<void> {
    const text = this.buildText(event);
    const url = `https://api.telegram.org/bot${this.cfg.bot_token}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: this.cfg.chat_id, text, parse_mode: "Markdown" }),
    });
    if (!res.ok) throw new Error(`Telegram API returned ${res.status}`);
  }
}
