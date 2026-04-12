export function enqueuePrompt(queue: readonly string[], prompt: string): string[] {
  return [...queue, prompt];
}

export function takeNextQueuedPrompt(queue: readonly string[]): { nextPrompt: string | null; remaining: string[] } {
  if (queue.length === 0) return { nextPrompt: null, remaining: [] };
  const [nextPrompt, ...remaining] = queue;
  return { nextPrompt, remaining };
}
