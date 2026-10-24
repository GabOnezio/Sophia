// Control UI Alive page: client-driven failover across the "Voz" roster
// configured in Configuração Viva (agents.defaults.voiceModel).
//
// Realtime Talk sessions are a persistent stream, not a one-shot request, so
// OpenClaw's existing per-call fallback engine (used by the agent's thinking
// model and by image/video/music generation tool calls) never sees them — a
// billing/credit failure from the connected provider only surfaces later, as
// an async error status on the live session, well after the RPC that created
// it already succeeded (see src/gateway/talk-realtime-relay.ts). Retrying
// that mid-flight from the browser — closing the failed session and
// launching a new one that explicitly requests the next starred candidate —
// is the smallest change that gets automatic switching without touching
// that relay's connection lifecycle.
import {
  parseRoster,
  readAgentToolModelField,
  readRosterAutoFailover,
  readRosterRatings,
} from "../live-config/model-roster.ts";

const BILLING_ERROR_PATTERNS: readonly RegExp[] = [
  /\b402\b/,
  /payment required/i,
  /insufficient[_ ]?(?:credits?|quota|balance)/i,
  /credit balance/i,
  /out of credits?/i,
  /billing/i,
  /spending limit/i,
  /plans? ?& ?billing/i,
];

/** Loose client-side heuristic for "this session failed because the
 * provider account is out of credit" — doesn't need to be as exhaustive as
 * the gateway's own classifier (src/agents/embedded-agent-helpers/failover-
 * matches.ts isBillingErrorMessage), just good enough to avoid retrying on
 * unrelated errors (network hiccups, invalid config, etc). */
export function looksLikeVoiceBillingError(message: string | null | undefined): boolean {
  if (!message) {
    return false;
  }
  return BILLING_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

/** Ordered, de-duped provider ids from the "Voz" roster (agents.defaults.
 * voiceModel), highest-starred first — the same order the gateway itself
 * would auto-select from when no explicit provider is requested. */
export function resolveVoiceFailoverProviderOrder(
  configObject: Record<string, unknown> | null,
): string[] {
  const toolModel = readAgentToolModelField(configObject, "voiceModel");
  const entries = parseRoster(toolModel, readRosterRatings(toolModel));
  const order: string[] = [];
  for (const entry of entries) {
    if (!order.includes(entry.provider)) {
      order.push(entry.provider);
    }
  }
  return order;
}

export function isVoiceAutoFailoverEnabled(configObject: Record<string, unknown> | null): boolean {
  return readRosterAutoFailover(readAgentToolModelField(configObject, "voiceModel"));
}
