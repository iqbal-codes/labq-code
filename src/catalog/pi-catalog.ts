import {
  CuratedPiCatalog,
  PiModelId,
  RuntimeAccessProfile,
  InteractionMode,
  ProviderCapabilities,
  ProviderCapability,
  CapabilityKind,
  Turn,
  TurnReviewState,
} from "../domain/types.js";

export const PI_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  provider_name: "pi",
  capabilities: {
    plan_mode: {
      kind: "plan_mode",
      supported: false,
      read_only: true,
      description: "Plan workflow mode is unsupported in Pi v1 delivery.",
    },
    diff: {
      kind: "diff",
      supported: true,
      read_only: true,
      description: "Read-only turn-associated change summaries derived from tool activity.",
    },
    checkpoint: {
      kind: "checkpoint",
      supported: false,
      read_only: true,
      description: "Transactional checkpoints are unsupported in Pi v1 delivery.",
    },
    rollback: {
      kind: "rollback",
      supported: false,
      read_only: true,
      description: "Rollback operations are unsupported in Pi v1 delivery.",
    },
  },
};

export const DEFAULT_PI_CATALOG: CuratedPiCatalog = {
  models: [
    {
      id: "pi-default",
      name: "Pi Default (Recommended)",
      authenticated: true,
      available: true,
    },
    {
      id: "pi-3.5-sonnet",
      name: "Pi 3.5 Sonnet",
      authenticated: true,
      available: true,
    },
    {
      id: "pi-3-opus",
      name: "Pi 3 Opus",
      authenticated: true,
      available: true,
    },
    {
      id: "pi-mini",
      name: "Pi Mini",
      authenticated: true,
      available: true,
    },
  ],
  access_profiles: [
    {
      profile: "read-only",
      name: "Read-Only Access",
      tools: ["read", "grep", "find", "ls"],
    },
    {
      profile: "workspace-write",
      name: "Workspace Write Access",
      tools: ["read", "grep", "find", "ls", "edit", "write"],
    },
    {
      profile: "full-execution",
      name: "Full Execution Access",
      tools: ["read", "grep", "find", "ls", "edit", "write", "bash"],
    },
  ],
  interaction_modes: [
    {
      mode: "execute",
      supported: true,
      description: "Direct execution mode for interactive coding tasks.",
    },
  ],
  capabilities: Object.values(PI_PROVIDER_CAPABILITIES.capabilities),
};

export function validateModel(
  model: string,
  catalog: CuratedPiCatalog = DEFAULT_PI_CATALOG
): model is PiModelId {
  return catalog.models.some((m) => m.id === model && m.available);
}

export function validateAccessProfile(
  profile: string,
  catalog: CuratedPiCatalog = DEFAULT_PI_CATALOG
): profile is RuntimeAccessProfile {
  return catalog.access_profiles.some((p) => p.profile === profile);
}

export function validateInteractionMode(
  mode: string,
  catalog: CuratedPiCatalog = DEFAULT_PI_CATALOG
): mode is InteractionMode {
  const item = catalog.interaction_modes.find((m) => m.mode === mode);
  return item !== undefined && item.supported;
}

export function getPiProviderCapabilities(): ProviderCapabilities {
  return structuredClone(PI_PROVIDER_CAPABILITIES);
}

export function isCapabilitySupported(
  capability: CapabilityKind,
  catalog: CuratedPiCatalog = DEFAULT_PI_CATALOG
): boolean {
  const cap = catalog.capabilities.find((c) => c.kind === capability);
  return cap !== undefined ? cap.supported : false;
}

export function deriveTurnReviewState(
  turn: Turn,
  catalog: CuratedPiCatalog = DEFAULT_PI_CATALOG
): TurnReviewState {
  const unsupported = catalog.capabilities
    .filter((c) => !c.supported)
    .map((c) => c.kind);

  return {
    turn_id: turn.id,
    read_only: true,
    supports_checkpoint: false,
    supports_rollback: false,
    change_summary: turn.change_summary,
    unsupported_operations: unsupported,
  };
}

export function canPerformRollback(
  _turn: Turn,
  _catalog: CuratedPiCatalog = DEFAULT_PI_CATALOG
): { allowed: false; reason: string } {
  return {
    allowed: false,
    reason: "Rollback operation is unsupported in Pi v1. Turn review state is read-only.",
  };
}

export function canPerformCheckpoint(
  _turn: Turn,
  _catalog: CuratedPiCatalog = DEFAULT_PI_CATALOG
): { allowed: false; reason: string } {
  return {
    allowed: false,
    reason: "Transactional checkpoints are unsupported in Pi v1.",
  };
}

export function canUsePlanMode(
  catalog: CuratedPiCatalog = DEFAULT_PI_CATALOG
): { allowed: false; reason: string } {
  const planCap = catalog.capabilities.find((c) => c.kind === "plan_mode");
  return {
    allowed: false,
    reason: planCap?.description ?? "Plan workflow mode is unsupported in Pi v1 delivery.",
  };
}
