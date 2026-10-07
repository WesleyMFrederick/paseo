import type { ProviderOptions } from "@getpaseo/protocol/agent-types";
import { z } from "zod";

// OMP owns the agent definitions. Paseo sends only the agent name; OMP resolves
// the role, model defaults, and tool limits.
export const OmpProviderOptionsSchema = z
  .object({
    agent: z.string().trim().min(1).optional(),
  })
  .strict() satisfies z.ZodType<ProviderOptions>;

export type OmpProviderOptions = z.infer<typeof OmpProviderOptionsSchema>;

/**
 * Reads the agent name from stored session options. The registry rejects
 * invalid shapes when the session starts, so this returns `undefined` for
 * mismatched structures.
 */
export function readOmpAgentOption(options: ProviderOptions | undefined): string | undefined {
  if (!options) {
    return undefined;
  }
  const parsed = OmpProviderOptionsSchema.safeParse(options);
  return parsed.success ? parsed.data.agent : undefined;
}
