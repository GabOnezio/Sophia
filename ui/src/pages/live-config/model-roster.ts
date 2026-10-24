// Control UI "Configuração Viva": pure logic for reading/writing an
// AgentToolModelConfig (agents.defaults.<category>Model — the same
// primary+fallbacks shape OpenClaw's existing failover engine already
// walks for image/video/music/voice generation, and agents.defaults.model
// for chat) as an ordered, star-rated list of provider entries. No new
// runtime/failover behavior is introduced here — this only decides what
// order `fallbacks[]` ends up in, which the existing engine already uses.
import type { AgentModelConfig, AgentToolModelConfig } from "../../../../src/config/types.agents-shared.js";

export type { AgentModelConfig, AgentToolModelConfig };

type AnyToolModelConfig = AgentModelConfig | AgentToolModelConfig | undefined | null;

/** Reads `configObject.agents.defaults` defensively from an untyped config
 * snapshot/form object (shared by Configuração Viva and the Alive page). */
export function readAgentDefaults(
  configObject: Record<string, unknown> | null,
): Record<string, unknown> {
  const agents = configObject?.agents as Record<string, unknown> | undefined;
  return (agents?.defaults as Record<string, unknown> | undefined) ?? {};
}

/** Reads one `agents.defaults.<field>` tool-model config (e.g. "voiceModel"). */
export function readAgentToolModelField(
  configObject: Record<string, unknown> | null,
  field: string,
): AgentToolModelConfig {
  return readAgentDefaults(configObject)[field] as AgentToolModelConfig;
}

export function readRosterRatings(
  toolModel: AnyToolModelConfig,
): Record<string, number> | undefined {
  return typeof toolModel === "object" && toolModel ? toolModel.ratings : undefined;
}

/** Reads the "autoFailover" flag (used by agents.defaults.voiceModel to gate
 * automatic switching to the next starred candidate on a billing/credit
 * failure) — defaults to true when unset. */
export function readRosterAutoFailover(toolModel: AnyToolModelConfig): boolean {
  if (typeof toolModel !== "object" || !toolModel) {
    return true;
  }
  return (toolModel as { autoFailover?: unknown }).autoFailover !== false;
}

export type RosterEntry = {
  /** The raw "provider" or "provider/model" string used in primary/fallbacks/ratings. */
  key: string;
  provider: string;
  model: string | null;
  /** 0 = not yet rated; 1-10 = user rating driving try-order. */
  stars: number;
};

export type RosterConfigPatch = {
  primary?: string;
  fallbacks: string[];
  ratings?: Record<string, number>;
};

function splitKey(key: string): { provider: string; model: string | null } {
  const slashIdx = key.indexOf("/");
  if (slashIdx === -1) {
    return { provider: key, model: null };
  }
  return { provider: key.slice(0, slashIdx), model: key.slice(slashIdx + 1) };
}

export function buildRosterKey(provider: string, model?: string | null): string {
  const trimmedModel = model?.trim();
  return trimmedModel ? `${provider}/${trimmedModel}` : provider;
}

/** Reads the ordered candidate list (primary first, then fallbacks, de-duped)
 * out of a raw AgentToolModelConfig plus its sibling ratings map. */
export function parseRoster(
  toolModel: AnyToolModelConfig,
  ratings: Record<string, number> | undefined,
): RosterEntry[] {
  const primary = typeof toolModel === "string" ? toolModel : toolModel?.primary;
  const rawFallbacks = typeof toolModel === "string" ? [] : (toolModel?.fallbacks ?? []);

  const orderedKeys: string[] = [];
  if (primary?.trim()) {
    orderedKeys.push(primary.trim());
  }
  for (const fallback of rawFallbacks) {
    const trimmed = typeof fallback === "string" ? fallback.trim() : "";
    if (trimmed && !orderedKeys.includes(trimmed)) {
      orderedKeys.push(trimmed);
    }
  }

  return orderedKeys.map((key) => {
    const { provider, model } = splitKey(key);
    return { key, provider, model, stars: ratings?.[key] ?? 0 };
  });
}

/** Recomputes {primary, fallbacks, ratings} from an edited entry list —
 * sorted by stars descending (ties keep their existing relative order, so
 * re-rating one entry doesn't reshuffle the others). The highest-rated
 * entry becomes `primary`; the rest become `fallbacks`, in try-order. */
export function buildRosterPatch(entries: RosterEntry[]): RosterConfigPatch {
  const sorted = [...entries].sort((a, b) => b.stars - a.stars);
  const [first, ...rest] = sorted;
  const ratings: Record<string, number> = {};
  for (const entry of entries) {
    if (entry.stars > 0) {
      ratings[entry.key] = entry.stars;
    }
  }
  return {
    primary: first?.key,
    fallbacks: rest.map((entry) => entry.key),
    ratings: Object.keys(ratings).length > 0 ? ratings : undefined,
  };
}

export function addRosterEntry(
  entries: RosterEntry[],
  input: { provider: string; model?: string | null; stars?: number },
): RosterEntry[] {
  const key = buildRosterKey(input.provider, input.model);
  const stars = input.stars ?? 0;
  const existingIndex = entries.findIndex((entry) => entry.key === key);
  if (existingIndex !== -1) {
    const next = [...entries];
    next[existingIndex] = { ...next[existingIndex], stars };
    return next;
  }
  return [...entries, { key, provider: input.provider, model: input.model?.trim() || null, stars }];
}

export function removeRosterEntry(entries: RosterEntry[], key: string): RosterEntry[] {
  return entries.filter((entry) => entry.key !== key);
}

export function setRosterStars(entries: RosterEntry[], key: string, stars: number): RosterEntry[] {
  const clamped = Math.max(0, Math.min(10, Math.round(stars)));
  return entries.map((entry) => (entry.key === key ? { ...entry, stars: clamped } : entry));
}

/**
 * `ratings` is a nested object in config, so OpenClaw's merge-patch merges
 * it into the existing object rather than replacing it wholesale — keys we
 * don't mention stay untouched. To make an edit (e.g. removing an entry)
 * actually drop its stale rating, this builds an explicit patch fragment:
 * `null` for keys that existed before but shouldn't anymore, the new value
 * for everything else. Returns null when there's nothing to change.
 */
export function buildRatingsMergePatchFragment(
  previous: Record<string, number> | undefined,
  next: Record<string, number> | undefined,
): Record<string, number | null> | null {
  const fragment: Record<string, number | null> = {};
  for (const key of Object.keys(previous ?? {})) {
    if (!next || !(key in next)) {
      fragment[key] = null;
    }
  }
  for (const [key, value] of Object.entries(next ?? {})) {
    fragment[key] = value;
  }
  return Object.keys(fragment).length > 0 ? fragment : null;
}
