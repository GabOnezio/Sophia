// Defines agent model selection schema fragments.
import { z } from "zod";

/** Per-candidate ("provider" or "provider/model") star rating, 0-10. Purely
 * a UI-facing priority signal — used by Control UI's "Configuração Viva" to
 * decide fallback try-order; not read by the agent runtime itself. */
const ModelCandidateRatingsSchema = z.record(z.string(), z.number().int().min(0).max(10));

/** Schema for agent model config accepting a string or fallback object. */
export const AgentModelSchema = z.union([
  z.string(),
  z
    .object({
      primary: z.string().optional(),
      fallbacks: z.array(z.string()).optional(),
      ratings: ModelCandidateRatingsSchema.optional(),
    })
    .strict(),
]);

export const AgentToolModelSchema = z.union([
  z.string(),
  z
    .object({
      primary: z.string().optional(),
      fallbacks: z.array(z.string()).optional(),
      timeoutMs: z.number().int().positive().optional(),
      ratings: ModelCandidateRatingsSchema.optional(),
      autoFailover: z.boolean().optional(),
    })
    .strict(),
]);
