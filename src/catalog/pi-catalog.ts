import {
  CuratedPiCatalog,
  PiModelId,
  RuntimeAccessProfile,
  InteractionMode,
} from "../domain/types.js";

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
    {
      mode: "plan",
      supported: false,
      description: "Plan workflow mode is unsupported in Pi v1 delivery.",
    },
  ],
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
