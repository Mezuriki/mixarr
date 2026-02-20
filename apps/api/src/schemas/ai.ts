import { z } from 'zod';

export const AI_STRATEGIES = ['similar', 'genre_expansion', 'discovery'] as const;

// PUT /settings — all fields optional for partial updates
export const updateAISettingsSchema = z.object({
  openaiApiKey: z.string().nullable().optional(),
  openaiEnabled: z.boolean().optional(),
  openaiStrategy: z.enum(AI_STRATEGIES).optional(),
  openaiBaseUrl: z.string().nullable().optional(),
  openaiModel: z.string().max(100).nullable().optional(),
  anthropicApiKey: z.string().nullable().optional(),
  anthropicEnabled: z.boolean().optional(),
  anthropicStrategy: z.enum(AI_STRATEGIES).optional(),
});

// POST /test
export const testAISchema = z.object({
  provider: z.enum(['openai', 'anthropic']),
});

// POST /recommendations
export const getRecommendationsSchema = z.object({
  artists: z.array(z.string().min(1)).min(1).max(100),
  maxRecommendations: z.number().int().positive().max(50).optional(),
});

// PUT /preferences
export const updatePreferencesSchema = z.object({
  strategy: z.enum(AI_STRATEGIES).optional(),
  maxRecommendations: z.number().int().positive().max(50).optional(),
  enabled: z.boolean().optional(),
});

// Export inferred types
export type UpdateAISettingsInput = z.infer<typeof updateAISettingsSchema>;
export type TestAIInput = z.infer<typeof testAISchema>;
export type GetRecommendationsInput = z.infer<typeof getRecommendationsSchema>;
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
