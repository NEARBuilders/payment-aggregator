export async function readWebhookBody(options: {
  input: unknown;
  getRawBody?: () => Promise<string>;
}): Promise<string> {
  const { input, getRawBody } = options;
  return (await getRawBody?.()) ?? JSON.stringify(input as unknown);
}

export function logWebhookProcessingError(options: {
  provider: string;
  error: unknown;
  details?: Record<string, unknown>;
}) {
  const { provider, error, details } = options;
  console.error(`[${provider} Webhook] Processing error:`, {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    ...details,
  });
}
