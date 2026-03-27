/**
 * Zod schema for agent hierarchy configuration.
 */

import { z } from "zod";

const AgentHierarchyLevelSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);

const AgentHierarchyPermissionsSchema = z
  .object({
    ssh: z.union([z.literal("all"), z.literal("own_machine"), z.literal("none")]).optional(),
    credentials: z.union([z.literal("all"), z.literal("read"), z.literal("none")]).optional(),
    gateway_restart: z.boolean().optional(),
    spawn_subagents: z.boolean().optional(),
    send_to_agents: z
      .union([z.literal("all"), z.literal("lead_only"), z.literal("team"), z.literal("none")])
      .optional(),
    tools_allow: z.array(z.string()).optional(),
    tools_deny: z.array(z.string()).optional(),
  })
  .strict();

export const AgentHierarchySchema = z
  .object({
    level: AgentHierarchyLevelSchema.optional(),
    lead: z.string().optional(),
    workers: z.array(z.string()).optional(),
    permissions: AgentHierarchyPermissionsSchema.optional(),
  })
  .strict()
  .optional();
