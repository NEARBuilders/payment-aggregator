import { z } from 'every-plugin/zod';

export const MANUAL_PROVIDER_FIELDS = {
  notificationEmails: { label: 'Notification Emails', order: 1 },
  ownerAccountIds: { label: 'Owner Account IDs', order: 2 },
  replyToEmail: { label: 'Reply-To Email', order: 3 },
} as const;

export type ManualProviderFields = typeof MANUAL_PROVIDER_FIELDS;

export const ManualProviderSettingsSchema = z.object({
  notificationEmails: z.array(z.string().email()).default([]),
  ownerAccountIds: z.array(z.string()).default([]),
  replyToEmail: z.string().email().optional(),
});

export type ManualProviderSettings = z.infer<typeof ManualProviderSettingsSchema>;