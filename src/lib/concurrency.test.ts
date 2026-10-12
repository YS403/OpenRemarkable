import { describe, expect, it } from "vitest";

import { Semaphore } from "./concurrency";

describe("Semaphore", () => {
  it("never runs more than the limit at once, even as slots hand over", async () => {
    const semaphore = new Semaphore(2);
    let running = 0;
    let peak = 0;
    const task = async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
    };
    await Promise.all(Array.from({ length: 10 }, () => semaphore.run(task)));
    expect(peak).toBe(2);
  });

  it("releases its slot when a task throws", async () => {
    const semaphore = new Semaphore(1);
    await expect(semaphore.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(semaphore.run(async () => "ok")).resolves.toBe("ok");
  });
});
