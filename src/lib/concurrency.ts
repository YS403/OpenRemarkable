/** Limits how many async tasks run at once; the rest wait in FIFO order. */
export class Semaphore {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly limit: number) {
    if (limit < 1) throw new Error("Semaphore limit must be at least 1.");
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.limit) this.active++;
    // A finishing task hands its slot straight to us, so `active` is unchanged.
    else await new Promise<void>((resolve) => this.queue.push(resolve));
    try {
      return await task();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
}
