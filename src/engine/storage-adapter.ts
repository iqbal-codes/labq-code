import type { DomainEvent, CommandReceipt, Snapshot } from "../domain/types.js";

/**
 * Storage state loaded from a durable backend on engine initialization.
 */
export interface StorageState {
  events: DomainEvent[];
  receipts: Map<string, CommandReceipt>;
  nextSequence: number;
}

/**
 * Typed persistence seam for orchestration state.
 *
 * Implementations provide durable storage (SQLite) or ephemeral in-memory
 * storage for tests. Domain callers (the engine) never see storage details.
 */
export interface StorageAdapter {
  /**
   * Load all persisted state for engine recovery.
   * Called once during engine construction.
   */
  loadAll(): StorageState;

  /**
   * Persist a batch of events atomically — all events from a single operation
   * succeed or fail together.
   */
  appendEvents(events: DomainEvent[]): Promise<void>;

  /**
   * Atomically persist a command's events AND its receipt.
   * This is the atomicity guarantee: a failed command never leaves an
   * unreceipted durable outcome or partial aggregate.
   */
  persistCommandResult(events: DomainEvent[], receipt: CommandReceipt): Promise<void>;

  /**
   * Persist a command receipt without events (e.g. validation-error results).
   */
  storeReceipt(receipt: CommandReceipt): Promise<void>;
}

/**
 * In-memory storage adapter — preserves current ephemeral behavior.
 * Used as the default when no durable backend is configured.
 */
export class InMemoryStorageAdapter implements StorageAdapter {
  private events: DomainEvent[] = [];
  private receipts: Map<string, CommandReceipt> = new Map();
  private nextSequence = 1;

  constructor() {
    // Default empty state; loadAll returns what was injected or built.
  }

  loadAll(): StorageState {
    return {
      events: [...this.events],
      receipts: new Map(this.receipts),
      nextSequence: this.nextSequence,
    };
  }

  async appendEvents(events: DomainEvent[]): Promise<void> {
    this.events.push(...events);
    this.updateNextSequence(events);
  }

  async persistCommandResult(events: DomainEvent[], receipt: CommandReceipt): Promise<void> {
    this.events.push(...events);
    this.receipts.set(receipt.command_id, receipt);
    this.updateNextSequence(events);
  }

  /** Keep nextSequence in sync with persisted events. */
  private updateNextSequence(events: DomainEvent[]): void {
    if (events.length > 0) {
      const maxSeq = events[events.length - 1].sequence;
      if (maxSeq >= this.nextSequence) {
        this.nextSequence = maxSeq + 1;
      }
    }
  }

  async storeReceipt(receipt: CommandReceipt): Promise<void> {
    this.receipts.set(receipt.command_id, receipt);
  }

  /** Expose internal state for test assertions / tear-down */
  get storedEvents(): DomainEvent[] {
    return [...this.events];
  }

  get storedReceipts(): Map<string, CommandReceipt> {
    return new Map(this.receipts);
  }

  get storedNextSequence(): number {
    return this.nextSequence;
  }
}