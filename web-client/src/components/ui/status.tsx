import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/format";
import { connectionLabel, connectionTone, syncLabel, syncTone } from "@/lib/format";
import type { ConnectionStatus, SyncStatus } from "@/orchestrator/store";

/**
 * Compact status pill with a text label and a tone-based border/color.
 * Color is never the only way to understand the state.
 */
export function StatusPill({
  label,
  tone,
  className,
}: {
  label: ReactNode;
  tone: Tone;
  className?: string;
}) {
  const colorByTone: Record<Tone, string> = {
    active: "#3fb950",
    idle: "#5a5a5a",
    warn: "#e3b341",
    hazard: "#ff4d4d",
  };
  const color = colorByTone[tone];
  return (
    <span
      className={cn(
        "tt-mono inline-flex items-center gap-1 border px-1.5 py-0.5 text-[11px] uppercase tracking-widest",
        className,
      )}
      style={{ borderColor: color, color }}
    >
      {label}
    </span>
  );
}

export function ConnectionPill({ connection }: { connection: ConnectionStatus }) {
  return <StatusPill label={connectionLabel(connection)} tone={connectionTone(connection)} />;
}

export function SyncPill({ sync }: { sync: SyncStatus }) {
  return <StatusPill label={syncLabel(sync)} tone={syncTone(sync)} />;
}
