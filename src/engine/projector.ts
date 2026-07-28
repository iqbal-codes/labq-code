import { Snapshot, DomainEvent, CuratedPiCatalog } from "../domain/types.js";
import { DEFAULT_PI_CATALOG } from "../catalog/pi-catalog.js";

export function createInitialSnapshot(
  catalog: CuratedPiCatalog = DEFAULT_PI_CATALOG
): Snapshot {
  return {
    sequence: 0,
    projects: {},
    threads: {},
    catalog,
  };
}

export function applyEvent(
  snapshot: Snapshot,
  event: DomainEvent
): Snapshot {
  // Create a shallow copy with fresh objects maps to preserve immutability
  const next: Snapshot = {
    sequence: event.sequence,
    projects: { ...snapshot.projects },
    threads: { ...snapshot.threads },
    catalog: snapshot.catalog,
  };

  switch (event.kind) {
    case "ProjectCreated": {
      const proj = event.data.project;
      next.projects[proj.id] = { ...proj };
      break;
    }
    case "ProjectArchived": {
      const proj = next.projects[event.data.project_id];
      if (proj) {
        next.projects[proj.id] = {
          ...proj,
          status: "archived",
          updated_at: event.timestamp,
        };
      }
      break;
    }
    case "ProjectSettled": {
      const proj = next.projects[event.data.project_id];
      if (proj) {
        next.projects[proj.id] = {
          ...proj,
          status: "settled",
          updated_at: event.timestamp,
        };
      }
      break;
    }
    case "ProjectDeleted": {
      const proj = next.projects[event.data.project_id];
      if (proj) {
        next.projects[proj.id] = {
          ...proj,
          status: "deleted",
          updated_at: event.timestamp,
        };
      }
      break;
    }
    case "ThreadCreated": {
      const th = event.data.thread;
      next.threads[th.id] = { ...th };
      break;
    }
    case "ThreadArchived": {
      const th = next.threads[event.data.thread_id];
      if (th) {
        next.threads[th.id] = {
          ...th,
          status: "archived",
          updated_at: event.timestamp,
        };
      }
      break;
    }
    case "ThreadSettled": {
      const th = next.threads[event.data.thread_id];
      if (th) {
        next.threads[th.id] = {
          ...th,
          status: "settled",
          updated_at: event.timestamp,
        };
      }
      break;
    }
    case "ThreadDeleted": {
      const th = next.threads[event.data.thread_id];
      if (th) {
        next.threads[th.id] = {
          ...th,
          status: "deleted",
          updated_at: event.timestamp,
        };
      }
      break;
    }
  }

  return next;
}

export function rebuildSnapshot(
  events: DomainEvent[],
  catalog: CuratedPiCatalog = DEFAULT_PI_CATALOG
): Snapshot {
  let snapshot = createInitialSnapshot(catalog);
  for (const event of events) {
    snapshot = applyEvent(snapshot, event);
  }
  return snapshot;
}
