/**
 * Event sink for `ctx.emit` (BOLT-EXT-1 E1).
 *
 * There is no structured run log on main yet, so events are rendered through the
 * run Logger: the terminal and the existing `.bolt/logs/bolt_<ts>.log` text file.
 * Library callers can also observe stamped events through `RunnerOptions.onEvent`.
 */
import type { BoltLogger, BoltPluginContext } from "./plugin";
import { RESULT_LIMITS, eventProblem, type BoltEvent, type StampedEvent } from "./handler-result";

export interface EventSinkOptions {
  logger?: BoltLogger;
  onEvent?: (event: StampedEvent) => void;
}

/** One per run: owns the monotonic `seq`. */
export class RunEvents {
  private seq = 0;
  constructor(private opts: EventSinkOptions) {}

  /** A scope for one handler or hook invocation. */
  scope(ref: string, step?: string): EventScope {
    return new EventScope(this, ref, step);
  }

  /** @internal */
  deliver(event: BoltEvent, ref: string, step?: string): void {
    const stamped: StampedEvent = { ...event, seq: ++this.seq, ref };
    if (step !== undefined) stamped.step = step;
    this.render(stamped);
    try {
      this.opts.onEvent?.(stamped);
    } catch {
      /* an observer must not break the handler */
    }
  }

  /** @internal */
  warn(message: string): void {
    this.opts.logger?.warn(message);
  }

  private render(event: StampedEvent): void {
    const logger = this.opts.logger;
    if (!logger) return;
    const p = event.progress;
    const progress = p
      ? ` ${p.current}${p.total !== undefined ? `/${p.total}` : ""}${p.unit ? ` ${p.unit}` : ""}`
      : "";
    const message = event.message ? `: ${event.message}` : "";
    const text = `${event.ref} ${event.type}${progress}${message}`;
    const detail = (logger as { step_detail?: (t: string) => void }).step_detail;
    if (event.type === "log") logger.info(`${event.ref}${message}`);
    else if (typeof detail === "function") detail.call(logger, text);
    else logger.info(text);
  }
}

export class EventScope {
  private settled = false;
  private warnedAfterSettle = false;
  private warnedTypes = new Set<string>();
  private count = 0;
  dropped = 0;

  constructor(
    private run: RunEvents,
    private ref: string,
    private step?: string,
  ) {}

  /** Synchronous and never throws into the caller. */
  readonly emit = (event: BoltEvent): void => {
    try {
      if (this.settled) {
        if (!this.warnedAfterSettle) {
          this.warnedAfterSettle = true;
          const type = (event as { type?: unknown })?.type;
          this.run.warn(
            `EMIT_AFTER_SETTLE: ${this.ref} emitted ${JSON.stringify(type ?? "event")} after its promise settled — forgot to await? The event was dropped.`,
          );
        }
        return;
      }
      const problem = eventProblem(event);
      if (problem) {
        const key = String((event as { type?: unknown })?.type);
        if (!this.warnedTypes.has(key)) {
          this.warnedTypes.add(key);
          this.run.warn(`EVENT_INVALID: ${this.ref} emitted an invalid event: ${problem}`);
        }
        return;
      }
      if (++this.count > RESULT_LIMITS.eventsPerStep) {
        this.dropped++;
        return;
      }
      this.run.deliver(event, this.ref, this.step);
    } catch {
      /* ctx.emit never throws into the handler */
    }
  };

  settle(): void {
    this.settled = true;
    if (this.dropped > 0) {
      this.run.warn(
        `EVENTS_DROPPED: ${this.ref} emitted more than ${RESULT_LIMITS.eventsPerStep} events; ${this.dropped} were dropped.`,
      );
    }
  }

  bind(ctx: Omit<BoltPluginContext, "emit">): BoltPluginContext {
    return { ...ctx, emit: this.emit };
  }
}
