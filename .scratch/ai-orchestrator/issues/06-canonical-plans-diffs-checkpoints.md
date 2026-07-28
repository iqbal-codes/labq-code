# 06 — Canonical Plans, Diffs, and Checkpoint State

**What to build:** The workspace exposes provider-neutral turn-associated change summaries when supported by the selected provider, without exposing raw Pi payloads or requiring full VCS integration. Pi v1 does not provide plan mode, transactional checkpoints, or rollback; those capabilities remain explicit unsupported states.

**Blocked by:** 02 — Provider-Backed Streamed Turns

**Status:** done

- [x] Canonical change summaries, when available, are associated with the originating turn and remain available from snapshots and ordered events.
- [x] Provider capabilities explicitly identify supported and unsupported plan, diff, checkpoint, and rollback operations; Pi advertises execute-only interaction and no checkpoint/rollback mutation.
- [x] Pi v1 review state is read-only and never treats an edit patch as a transactional checkpoint or rollback operation.
- [x] Projection, provider capability, and client derivation tests verify turn association, bounded summaries, unsupported operations, and no false rollback affordance.
