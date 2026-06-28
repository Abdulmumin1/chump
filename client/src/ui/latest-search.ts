type PendingRequest<Query> = {
  generation: number;
  query: Query;
};

/**
 * Runs at most one search at a time and coalesces a busy input stream to the
 * newest query. Results from superseded requests are ignored.
 */
export class LatestSearch<Query, Result> {
  private generation = 0;
  private pending: PendingRequest<Query> | null = null;
  private running = false;
  private readonly run: (query: Query) => Promise<Result>;
  private readonly onResult: (query: Query, result: Result) => void;
  private readonly onError: (query: Query, error: unknown) => void;

  constructor(
    run: (query: Query) => Promise<Result>,
    onResult: (query: Query, result: Result) => void,
    onError: (query: Query, error: unknown) => void,
  ) {
    this.run = run;
    this.onResult = onResult;
    this.onError = onError;
  }

  request(query: Query): void {
    this.pending = { generation: ++this.generation, query };
    void this.drain();
  }

  cancel(): void {
    this.generation += 1;
    this.pending = null;
  }

  private async drain(): Promise<void> {
    if (this.running || !this.pending) {
      return;
    }

    const request = this.pending;
    this.pending = null;
    this.running = true;
    try {
      const result = await this.run(request.query);
      if (request.generation === this.generation) {
        this.onResult(request.query, result);
      }
    } catch (error) {
      if (request.generation === this.generation) {
        this.onError(request.query, error);
      }
    } finally {
      this.running = false;
      if (this.pending) {
        void this.drain();
      }
    }
  }
}
