import type { LifecycleStatus, Project, SourceDescriptor } from "@labq/domain/types";
import type { ConnectionStatus, SyncStatus } from "../orchestrator/store";

export type Tone = "active" | "idle" | "warn" | "hazard";

export function lifecycleTone(status: LifecycleStatus): Tone {
  switch (status) {
    case "active":
      return "active";
    case "archived":
    case "settled":
      return "warn";
    case "deleted":
      return "hazard";
  }
}

export function lifecycleLabel(status: LifecycleStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function connectionLabel(connection: ConnectionStatus): string {
  switch (connection) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "reconnecting":
      return "Reconnecting";
    case "disconnected":
      return "Disconnected";
  }
}

export function connectionTone(connection: ConnectionStatus): Tone {
  switch (connection) {
    case "connected":
      return "active";
    case "connecting":
    case "reconnecting":
      return "warn";
    case "disconnected":
      return "hazard";
  }
}

export function syncLabel(sync: SyncStatus): string {
  switch (sync) {
    case "synced":
      return "Synchronized";
    case "syncing":
      return "Syncing";
    case "stale":
      return "Stale (cached)";
    case "gap":
      return "Recovering";
    case "idle":
      return "Idle";
  }
}

export function syncTone(sync: SyncStatus): Tone {
  switch (sync) {
    case "synced":
      return "active";
    case "syncing":
    case "gap":
      return "warn";
    case "stale":
    case "idle":
      return "idle";
  }
}

export function sourceSummary(source: Project["source"] | SourceDescriptor): string {
  switch (source.kind) {
    case "local_folder":
      return `Local folder · ${"locator" in source ? source.locator : ""}`;
    case "git_url":
      return `Git URL · ${"locator" in source ? source.locator : ""}`;
    default:
      return `${source.kind} · setup required`;
  }
}
