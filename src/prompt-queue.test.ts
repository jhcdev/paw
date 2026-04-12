import { describe, expect, it } from "vitest";

import { enqueuePrompt, takeNextQueuedPrompt } from "./prompt-queue.js";

describe("prompt queue", () => {
  it("keeps prompts in FIFO order", () => {
    const queued = enqueuePrompt(enqueuePrompt([], "first"), "second");

    const first = takeNextQueuedPrompt(queued);
    const second = takeNextQueuedPrompt(first.remaining);

    expect(first.nextPrompt).toBe("first");
    expect(second.nextPrompt).toBe("second");
    expect(second.remaining).toEqual([]);
  });

  it("delivers one queued prompt at a time instead of merging them", () => {
    const queued = ["Summarize README", "Also check CONTRIBUTING", "Compare both"];

    const first = takeNextQueuedPrompt(queued);
    const second = takeNextQueuedPrompt(first.remaining);
    const third = takeNextQueuedPrompt(second.remaining);

    expect(first.nextPrompt).toBe("Summarize README");
    expect(first.remaining).toEqual(["Also check CONTRIBUTING", "Compare both"]);
    expect(second.nextPrompt).toBe("Also check CONTRIBUTING");
    expect(third.nextPrompt).toBe("Compare both");
  });
});
