export interface SourceMonitorAccess {
  fingerprint(): Promise<string>;
  signature(authoritative: boolean): Promise<string>;
  day(): string;
  changed(message: string): void;
}

/** One serialized checker shared by file events, polling, and manual reloads. */
export class SourceMonitor {
  private fingerprint: string | null = null;
  private signature: string | null = null;
  private day: string | null = null;
  private queue: Promise<void> = Promise.resolve();
  private checking: Promise<void> | null = null;
  private forceRequested = false;

  private access: SourceMonitorAccess;

  constructor(access: SourceMonitorAccess) { this.access = access; }

  check(authoritative = false): Promise<void> {
    this.forceRequested ||= authoritative;
    if (this.checking) return this.checking;
    const run = this.enqueue(async () => {
      do {
        const force = this.forceRequested;
        this.forceRequested = false;
        await this.probe(force, true);
      } while (this.forceRequested);
    });
    this.checking = run.finally(() => { this.checking = null; });
    return this.checking;
  }

  /** Capture the source about to be rendered; later changes still notify. */
  acknowledge(): Promise<void> {
    return this.enqueue(() => this.probe(true, false));
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const run = this.queue.then(operation);
    this.queue = run.catch(() => {});
    return run;
  }

  private async probe(authoritative: boolean, notify: boolean): Promise<void> {
    const day = this.access.day();
    let fingerprint: string;
    try {
      fingerprint = await this.access.fingerprint();
    } catch (error) {
      fingerprint = `unavailable:${String(error)}`;
    }
    if (!authoritative && fingerprint === this.fingerprint && day === this.day) return;
    let signature: string;
    let message = 'Updated data available';
    try {
      signature = await this.access.signature(authoritative);
    } catch (error) {
      signature = `unavailable:${String(error)}`;
      message = 'Database unavailable or awaiting a WAL checkpoint';
    }
    const changed = this.signature !== null && (signature !== this.signature || day !== this.day);
    this.fingerprint = fingerprint;
    this.signature = signature;
    this.day = day;
    if (changed && notify) this.access.changed(message);
  }
}
