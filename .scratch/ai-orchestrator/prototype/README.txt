TERMINAL WORKSPACE MOCKUP

Question: does one server-authoritative state model cleanly express durable command
idempotency, streamed runtime updates, approval/input pauses, interruption, and
bounded reconnect recovery without stale or duplicate client state?

Run:

python3 .scratch/ai-orchestrator/prototype/tui.py

Try these first:

demo approval
demo complete

The TUI renders a three-region workspace: project/thread navigation,
conversation, and activity/action-required state. The reducer in model.py
remains the behavior reference; the terminal shell is a disposable visual
mockup of docs/ui-specs/ai-orchestrator.md.
