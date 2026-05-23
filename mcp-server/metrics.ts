import { estimateTokens } from '../src/features/mcp-tools/application/tools';

/**
 * Per-tool-call token-cost ledger. The thesis says MCP-mediated editing
 * beats blob-in-prompt on tokens. To validate that, we have to *measure*
 * the cost of every read response. Writes return slim acks and are skipped
 * (their token cost is dominated by the input, which the LLM already pays
 * upstream).
 *
 * In-memory by design: instance-independent stays instance-independent,
 * and the SvelteKit app can read this via a future REST or directly when
 * embedded. Bounded ring buffer so a long-running server doesn't grow
 * without bound.
 */
export type TokenEvent = {
  readonly tool: string;
  readonly outTokens: number;
  readonly ts: string;
};

export type MetricsTotals = {
  readonly tool: string;
  readonly callCount: number;
  readonly totalOutTokens: number;
  readonly avgOutTokens: number;
  readonly maxOutTokens: number;
};

const MAX_EVENTS = 500;

class MetricsCollector {
  private readonly events: TokenEvent[] = [];
  /** ISO timestamp of the most recent record() call. State: mcp.lastRequestedAt. */
  lastRequestedAt: string | null = null;
  /** Last MCP tool error surfaced to the client. State: mcp.lastError. */
  lastError: { tool: string; message: string; at: string } | null = null;

  record(tool: string, outTokens: number, now: () => string = () => new Date().toISOString()): void {
    const ts = now();
    this.events.push({ tool, outTokens, ts });
    this.lastRequestedAt = ts;
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }
  }

  recordError(tool: string, message: string, now: () => string = () => new Date().toISOString()): void {
    this.lastError = { tool, message, at: now() };
  }

  recent(limit = 100): readonly TokenEvent[] {
    return this.events.slice(-limit);
  }

  totals(): readonly MetricsTotals[] {
    const byTool = new Map<string, { count: number; total: number; max: number }>();
    for (const e of this.events) {
      const cur = byTool.get(e.tool) ?? { count: 0, total: 0, max: 0 };
      cur.count += 1;
      cur.total += e.outTokens;
      if (e.outTokens > cur.max) cur.max = e.outTokens;
      byTool.set(e.tool, cur);
    }
    return [...byTool.entries()]
      .map(([tool, v]) => ({
        tool,
        callCount: v.count,
        totalOutTokens: v.total,
        avgOutTokens: v.count === 0 ? 0 : Math.round(v.total / v.count),
        maxOutTokens: v.max
      }))
      .sort((a, b) => b.totalOutTokens - a.totalOutTokens);
  }

  reset(): void {
    this.events.length = 0;
  }
}

export const metrics = new MetricsCollector();

/**
 * Record the cost of a tool result and return the result unchanged. Use at
 * the call site of every read tool so token usage is captured end-to-end.
 */
export const trackTokens = <T>(tool: string, value: T): T => {
  metrics.record(tool, estimateTokens(value));
  return value;
};
