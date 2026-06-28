export function nearAccountIdToEmail(accountId: string): string | undefined {
  const trimmed = accountId?.trim().toLowerCase();
  if (!trimmed) return undefined;

  if (!trimmed.endsWith('.near')) return undefined;

  const parts = trimmed.split('.');
  if (parts.length !== 2) return undefined;

  const prefix = parts[0]!;
  if (!/^[a-z0-9_-]+$/.test(prefix)) return undefined;

  return `${trimmed}@near.email`;
}

export function resolveNotificationEmails(
  globalEmails: string[],
  globalOwnerAccountIds: string[],
  perProductEntries: Array<{
    notificationEmails?: string[];
    ownerAccountIds?: string[];
  }>,
): string[] {
  const allEmails: string[] = [
    ...globalEmails,
    ...globalOwnerAccountIds
      .map((id) => nearAccountIdToEmail(id))
      .filter((e): e is string => e !== undefined),
  ];

  for (const entry of perProductEntries) {
    if (entry.notificationEmails) {
      allEmails.push(...entry.notificationEmails);
    }
    if (entry.ownerAccountIds) {
      allEmails.push(
        ...entry.ownerAccountIds
          .map((id) => nearAccountIdToEmail(id))
          .filter((e): e is string => e !== undefined),
      );
    }
  }

  return [...new Set(allEmails)];
}