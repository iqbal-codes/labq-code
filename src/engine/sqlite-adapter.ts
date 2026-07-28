import { Database, type Statement } from "bun:sqlite";
import type { DomainEvent, CommandReceipt, CommandResult } from "../domain/types.js";
import type { StorageAdapter, StorageState } from "./storage-adapter.js";

/**
 * Bun SQLite-backed durable storage adapter.
 *
 * Stores events in an append-only event stream, command receipts for
 * idempotency, and a next-sequence counter. All state is recoverable
 * after process restart.
 */
export class BunSqliteStorageAdapter implements StorageAdapter {
  private db: Database;
  private writeLock = Promise.resolve();
  private insertEventStmt: Statement;
  private insertReceiptStmt: Statement;
  private saveSeqStmt: Statement;

  /**
   * @param filePath Path to the SQLite database file. ":memory:" for in-memory SQLite.
   */
  constructor(filePath: string) {
    this.db = new Database(filePath, { strict: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.migrate();

    // Prepare statements once, reuse across all write methods
    this.insertEventStmt = this.db.prepare(
      "INSERT INTO events (sequence, event_id, timestamp, command_id, correlation_id, causation_id, kind, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    this.insertReceiptStmt = this.db.prepare(
      "INSERT OR REPLACE INTO receipts (command_id, result_json, sequences_json) VALUES (?, ?, ?)"
    );
    this.saveSeqStmt = this.db.prepare(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('next_sequence', ?)"
    );
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        sequence INTEGER PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE,
        timestamp TEXT NOT NULL,
        command_id TEXT NOT NULL,
        correlation_id TEXT,
        causation_id TEXT,
        kind TEXT NOT NULL,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS receipts (
        command_id TEXT PRIMARY KEY,
        result_json TEXT NOT NULL,
        sequences_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  loadAll(): StorageState {
    const events = this.loadEvents();
    const receipts = this.loadReceipts();
    const nextSequence = this.loadNextSequence(events);

    return { events, receipts, nextSequence };
  }

  private loadEvents(): DomainEvent[] {
    const rows = this.db
      .query<
        {
          sequence: number;
          event_id: string;
          timestamp: string;
          command_id: string;
          correlation_id: string | null;
          causation_id: string | null;
          kind: string;
          data: string;
        },
        []
      >(
        "SELECT sequence, event_id, timestamp, command_id, correlation_id, causation_id, kind, data FROM events ORDER BY sequence ASC"
      )
      .all();

    return rows.map((r) => {
      const data = JSON.parse(r.data);
      return {
        sequence: r.sequence,
        event_id: r.event_id,
        timestamp: r.timestamp,
        command_id: r.command_id,
        correlation_id: r.correlation_id ?? undefined,
        causation_id: r.causation_id ?? undefined,
        kind: r.kind,
        data,
      } as DomainEvent;
    });
  }

  private loadReceipts(): Map<string, CommandReceipt> {
    const rows = this.db
      .query<{ command_id: string; result_json: string; sequences_json: string }, []>(
        "SELECT command_id, result_json, sequences_json FROM receipts"
      )
      .all();

    const receipts = new Map<string, CommandReceipt>();
    for (const r of rows) {
      receipts.set(r.command_id, {
        command_id: r.command_id,
        result: JSON.parse(r.result_json) as CommandResult,
        sequences: JSON.parse(r.sequences_json) as number[],
      });
    }
    return receipts;
  }

  private loadNextSequence(events: DomainEvent[]): number {
    // Check meta table first
    const row = this.db
      .query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'next_sequence'")
      .get();
    if (row) {
      return Number(row.value);
    }
    // Fall back to max sequence in events
    if (events.length > 0) {
      return events[events.length - 1].sequence + 1;
    }
    return 1;
  }

  private bindEvent(event: DomainEvent): unknown[] {
    return [
      event.sequence,
      event.event_id,
      event.timestamp,
      event.command_id,
      event.correlation_id ?? null,
      event.causation_id ?? null,
      event.kind,
      JSON.stringify(event.data),
    ];
  }

  private runEventInsert(event: DomainEvent): void {
    this.insertEventStmt.run(...this.bindEvent(event));
  }

  private runSequenceSave(events: DomainEvent[]): void {
    if (events.length > 0) {
      this.saveSeqStmt.run(String(events[events.length - 1].sequence + 1));
    }
  }

  private runReceiptInsert(receipt: CommandReceipt): void {
    this.insertReceiptStmt.run(
      receipt.command_id,
      JSON.stringify(receipt.result),
      JSON.stringify(receipt.sequences)
    );
  }

  async appendEvents(events: DomainEvent[]): Promise<void> {
    if (events.length === 0) return;

    await this.serialized(() => {
      const tx = this.db.transaction(() => {
        for (const event of events) {
          this.runEventInsert(event);
        }
        this.runSequenceSave(events);
      });
      tx();
    });
  }

  async persistCommandResult(events: DomainEvent[], receipt: CommandReceipt): Promise<void> {
    await this.serialized(() => {
      const tx = this.db.transaction(() => {
        for (const event of events) {
          this.runEventInsert(event);
        }
        this.runReceiptInsert(receipt);
        if (events.length > 0) {
          this.runSequenceSave(events);
        }
      });
      tx();
    });
  }

  async storeReceipt(receipt: CommandReceipt): Promise<void> {
    await this.serialized(() => {
      this.runReceiptInsert(receipt);
    });
  }

  /**
   * Execute a write operation serially to prevent concurrent write contention.
   */
  private async serialized<T>(fn: () => T): Promise<T> {
    const prev = this.writeLock;
    let resolve: () => void;
    this.writeLock = new Promise<void>((r) => {
      resolve = r;
    });
    await prev;
    try {
      return fn();
    } finally {
      resolve!();
    }
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }
}