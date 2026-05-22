import { z } from 'zod';

export const modelSteeringPrefsSchema = z
  .object({
    enabled: z.boolean().optional(),
  })
  .strict();

export type TModelSteeringPrefs = z.infer<typeof modelSteeringPrefsSchema>;

export const modelSteeringPrefsUpdateSchema = modelSteeringPrefsSchema.partial();
export type TModelSteeringPrefsUpdate = z.infer<typeof modelSteeringPrefsUpdateSchema>;

export const modelSteeringRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(4000),
    conversationId: z.string().min(1),
    streamId: z.string().optional(),
  })
  .passthrough();

export type TModelSteeringRequest = z.infer<typeof modelSteeringRequestSchema>;

export type TModelSteeringResponse = {
  streamId: string;
  conversationId: string;
  status: 'started';
};
