import { z } from "zod";
import type { GenerateRequest, GenerationMode } from "@/lib/types";

export const generationModeSchema = z.enum(["quick", "expert"]);

export const generateSchema: z.ZodType<GenerateRequest> = z.object({
  analysis: z.any(),
  sourceText: z.string().optional(),
  selectedArc: z.string(),
  styleProfile: z
    .object({
      id: z.string(),
      label: z.string(),
      summary: z.string(),
      prompt: z.string(),
      source: z.enum(["preset", "analysis", "neutral"]),
      provenance: z.string().optional(),
      dimensions: z.array(z.string()).optional(),
    })
    .optional(),
  generationMode: generationModeSchema.optional(),
  thinkingEnabled: z.boolean().optional(),
  length: z.enum(["short", "medium", "long"]),
  styleIntensity: z.number().min(0).max(100),
  access: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("internal"),
    }),
    z.object({
      mode: z.literal("custom"),
      endpoint: z.string().url(),
      apiKey: z.string().min(1),
      model: z.string().min(1),
    }),
  ]),
});

export function generationModeFor(payload: Pick<GenerateRequest, "generationMode" | "selectedArc">): GenerationMode {
  if (payload.generationMode) {
    return payload.generationMode;
  }

  return "quick";
}
