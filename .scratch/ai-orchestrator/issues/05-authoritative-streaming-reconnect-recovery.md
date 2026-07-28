# 05 — Authoritative Streaming and Reconnect Recovery

**What to build:** A web client can bootstrap from a snapshot, consume ordered live events, disconnect, and reconnect from its last exclusive sequence. It detects gaps, retries bounded resubscription and replay, falls back to a fresh snapshot when needed, and never lets stale cached state overwrite newer live state.

**Blocked by:** 04 — Interrupt, Stop, and Provider-Exit Handling

**Status:** ready-for-agent

- [ ] The typed transport validates wire shape and authorization before dispatching commands or creating environment- and thread-scoped subscriptions.
- [ ] A subscription begins with a synchronization snapshot or marker and then emits one server-authoritative ordered event stream; replay starts strictly after an exclusive sequence cursor.
- [ ] Recovery handles an exact replay boundary, sequence gaps, failed replay, no-progress limits, involuntary disconnects, and bounded snapshot fallback deterministically.
- [ ] The client applies each sequence at most once, preserves newer live state during fast reconnects, and converges to a fresh server snapshot without duplicate messages, activities, approvals, or turns.
- [ ] Transport, authorization, subscription, and recovery tests cover read-only observation, mutation denial, replay, gap detection, resubscription, fallback, and convergence.
