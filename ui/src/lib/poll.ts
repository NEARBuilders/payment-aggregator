export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

export async function pollUntil<T>(
  fetcher: () => Promise<T>,
  predicate: (value: T) => boolean,
  { intervalMs = 3000, timeoutMs = 120_000 }: PollOptions = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await fetcher();
  while (!predicate(last)) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for the expected state");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    last = await fetcher();
  }
  return last;
}
