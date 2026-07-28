#!/usr/bin/env python3
"""Terminal workspace mockup for the AI orchestrator prototype.

Run with:
    python3 .scratch/ai-orchestrator/prototype/tui.py

The reducer in ``model.py`` remains the behavior reference. This file is a
disposable visual mockup of the proposed web client's hierarchy: project/thread
navigation, conversation, work activity, pending requests, and sync health.
"""

import shlex
import shutil
import sys
import textwrap

from model import initial_state, step


RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
CYAN = "\033[36m"
BLUE = "\033[34m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
MAGENTA = "\033[35m"


def use_color():
    return sys.stdout.isatty() and not bool(__import__("os").environ.get("NO_COLOR"))


COLOR = use_color()


def paint(value, color):
    return f"{color}{value}{RESET}" if COLOR else value


def command(command_id, kind, **payload):
    return {"type": "command", "command_id": command_id, "kind": kind, "payload": payload}


def parse(line):
    parts = shlex.split(line)
    if not parts:
        return None
    op = parts[0]
    if op in {"q", "quit", "exit"}:
        return {"type": "quit"}
    if op in {"help", "?"}:
        return {"type": "help"}
    if op == "demo":
        return {"type": "demo", "mode": parts[1] if len(parts) > 1 else "approval"}
    if op == "show":
        return {"type": "show"}
    if op == "sync":
        return {"type": "sync", "cursor": int(parts[1]) if len(parts) > 1 else 0}
    if op == "project":
        return command(parts[1], "create_project", project_id=parts[2], name=" ".join(parts[3:]))
    if op == "thread":
        options = dict(item.split("=", 1) for item in parts[3:])
        return command(
            parts[1],
            "create_thread",
            thread_id=parts[2],
            model=options.get("model", "provider/model"),
            access_mode=options.get("access", "workspace"),
            interaction_mode=options.get("mode", "execute"),
        )
    if op == "start":
        return command(parts[1], "start_turn", turn_id=parts[2], prompt=" ".join(parts[3:]))
    if op == "delta":
        return command(parts[1], "runtime_delta", event_id=parts[1], delta=" ".join(parts[2:]))
    if op == "activity":
        return command(
            parts[1],
            "runtime_activity",
            event_id=parts[1],
            activity_id=parts[2],
            activity_kind=parts[3],
            summary=" ".join(parts[4:]),
        )
    if op == "finish-activity":
        return command(
            parts[1],
            "finish_activity",
            activity_id=parts[2],
            status=parts[3],
            summary=" ".join(parts[4:]),
        )
    if op == "approval":
        return command(
            parts[1],
            "runtime_approval",
            event_id=parts[1],
            request_id=parts[2],
            operation=" ".join(parts[3:]),
        )
    if op == "input":
        fields = parts[4].split(",") if len(parts) > 4 else ["answer"]
        return command(
            parts[1],
            "runtime_input",
            event_id=parts[1],
            request_id=parts[2],
            operation=parts[3],
            fields=fields,
        )
    if op == "approve":
        return command(parts[1], "respond_approval", request_id=parts[2], decision=parts[3])
    if op == "answer":
        return command(parts[1], "respond_input", request_id=parts[2], decision="answered")
    if op == "complete":
        return command(parts[1], "runtime_complete", event_id=parts[1], final=" ".join(parts[2:]))
    if op == "interrupt":
        return command(parts[1], "interrupt_turn", reason=" ".join(parts[2:]) or "user_interrupt")
    if op == "stop":
        return command(parts[1], "stop_session")
    if op == "archive":
        return command(parts[1], "archive_thread")
    if op == "settle":
        return command(parts[1], "settle_thread")
    if op == "delete":
        return command(parts[1], "delete_thread")
    return {"type": "invalid", "message": f"Unknown command: {op}"}


def width():
    return max(78, min(shutil.get_terminal_size((120, 40)).columns, 160))


def clip(value, size):
    value = str(value)
    return value if len(value) <= size else value[: max(0, size - 1)] + "…"


def wrap(value, size):
    return textwrap.wrap(str(value), width=max(8, size), break_long_words=False) or [""]


def status_badge(status):
    labels = {
        "none": ("NO SESSION", DIM),
        "ready": ("READY", GREEN),
        "running": ("RUNNING", CYAN),
        "stopped": ("STOPPED", YELLOW),
        "queued": ("QUEUED", YELLOW),
        "waiting_approval": ("WAITING FOR APPROVAL", MAGENTA),
        "waiting_input": ("WAITING FOR INPUT", MAGENTA),
        "completed": ("COMPLETED", GREEN),
        "interrupted": ("INTERRUPTED", YELLOW),
        "failed": ("FAILED", RED),
        "active": ("ACTIVE", GREEN),
        "archived": ("ARCHIVED", DIM),
        "settled": ("SETTLED", BLUE),
        "deleted": ("DELETED", RED),
    }
    label, color = labels.get(status, (str(status).upper(), DIM))
    return paint(f"[{label}]", color)


def section(title, lines, panel_width, accent=CYAN):
    inner = max(10, panel_width - 4)
    output = [paint("┌─ " + clip(title, inner - 3) + " " * max(0, inner - len(clip(title, inner - 3)) - 3) + "┐", accent)]
    for line in lines:
        chunks = wrap(line, inner)
        for chunk in chunks:
            output.append("│ " + chunk.ljust(inner) + " │")
    output.append("└" + "─" * (inner + 2) + "┘")
    return output


def side_panel(server, panel_width):
    project = server["project"]
    thread = server["thread"]
    lines = [paint("PROJECT", BOLD)]
    if project is None:
        lines += [paint("  No projects yet", DIM), "", paint("  Create a durable home", DIM)]
    else:
        lines += [f"  {clip(project['name'], panel_width - 8)}", f"  {status_badge(project['status'])}"]
        lines += ["", paint("THREADS", BOLD)]
        if thread is None:
            lines.append(paint("  No threads yet", DIM))
        else:
            lines += [f"  ● {clip(thread['id'], panel_width - 8)}", f"    {status_badge(thread['status'])}"]
            lines += ["", paint("CONFIGURATION", BOLD)]
            lines += [f"  model   {clip(thread['model'], panel_width - 10)}"]
            lines += [f"  access  {clip(thread['access_mode'], panel_width - 10)}"]
            lines += [f"  mode    {clip(thread['interaction_mode'], panel_width - 10)}"]
    return section("NAVIGATION", lines, panel_width, BLUE)


def conversation_panel(server, panel_width):
    thread = server["thread"]
    turn = server["turn"]
    lines = []
    if thread is None:
        lines += [paint("No active thread", BOLD), "", "Create a project and thread to begin."]
    else:
        lines += [f"{paint('THREAD', DIM)}  {thread['id']}", f"{paint('SESSION', DIM)} {status_badge(server['session_status'])}", ""]
        if not server["messages"]:
            lines += [paint("No messages yet", BOLD), "", "Send a prompt to start a durable turn."]
        else:
            for message in server["messages"]:
                role = "YOU" if message["role"] == "user" else "AGENT"
                accent = BLUE if role == "YOU" else CYAN
                lines.append(paint(f"{role}  ·  {message['id']}", accent))
                for content_line in wrap(message["content"], max(12, panel_width - 8)):
                    lines.append("  " + content_line)
                lines.append("")
        if turn is not None:
            lines += [paint("CURRENT TURN", BOLD), f"{turn['id']}  {status_badge(turn['status'])}"]
            if turn.get("final"):
                lines += ["  " + line for line in wrap(turn["final"], max(12, panel_width - 8))]
    return section("CONVERSATION", lines, panel_width, CYAN)


def activity_panel(server, client, panel_width):
    turn = server["turn"]
    pending = server["pending_request"]
    lines = [paint("SYNC", BOLD)]
    sync_mode = client.get("sync_mode", "live")
    lines += [f"  {status_badge('ready' if sync_mode in {'live', 'up_to_date'} else 'running')} {sync_mode.replace('_', ' ')}", f"  sequence {client.get('last_sequence', server['next_sequence'] - 1)}", ""]
    lines.append(paint("WORK LOG", BOLD))
    if not server["activities"]:
        lines.append(paint("  No activity yet", DIM))
    else:
        for activity in server["activities"][-5:]:
            marker = {"running": "▶", "succeeded": "✓", "failed": "!", "declined": "×", "interrupted": "■"}.get(activity["status"], "·")
            lines.append(f"  {marker} {clip(activity['kind'], panel_width - 10)}")
            lines.append(f"    {clip(activity['summary'], panel_width - 8)} {status_badge(activity['status'])}")
    lines.append("")
    if pending is not None:
        lines += [paint("ACTION REQUIRED", BOLD), paint(f"  {pending['kind'].upper()}", MAGENTA), f"  {clip(pending['operation'], panel_width - 8)}", f"  request {pending['id']}"]
        if pending["kind"] == "input":
            lines.append(f"  fields: {', '.join(pending['fields'])}")
        lines += ["", paint("  Respond from the command bar", DIM)]
    elif turn is not None and turn["status"] in {"running", "queued"}:
        lines += [paint("LIVE TURN", BOLD), "  Follow activity as it arrives.", "  interrupt CMD REASON..."]
    else:
        lines += [paint("WORKSPACE", BOLD), "  No action required."]
    return section("ACTIVITY", lines, panel_width, MAGENTA if pending else CYAN)


def command_legend():
    return [
        paint("COMMAND BAR", BOLD),
        "demo [approval|complete]   load a visual scenario",
        "project CMD ID NAME...     create project",
        "thread CMD ID model=X access=X mode=X",
        "start CMD TURN PROMPT...   send prompt",
        "delta EVENT TEXT...         stream assistant text",
        "activity EVENT ID KIND...  append work activity",
        "approval EVENT REQUEST OP   pause for approval",
        "input EVENT REQUEST OP FIELDS  pause for input",
        "approve CMD REQUEST yes|no  answer approval",
        "answer CMD REQUEST          answer input",
        "complete EVENT FINAL...     settle turn",
        "sync CURSOR | interrupt CMD REASON | stop CMD",
        "archive CMD | settle CMD | delete CMD | show | help | q",
    ]


def render(state, notice):
    server = state["server"]
    client = state["client"]
    terminal_width = width()
    print("\033[2J\033[H", end="")
    title = " AI ORCHESTRATOR "
    subtitle = "durable agent workspace / server-authoritative state"
    print(paint(title.center(terminal_width, "═"), BOLD + CYAN))
    print(paint(subtitle.center(terminal_width), DIM))
    print()
    header = [
        f"ENV  local prototype",
        f"CONNECTION  {paint('CONNECTED', GREEN)}",
        f"SESSION  {status_badge(server['session_status'])}",
        f"EVENTS  {server['next_sequence'] - 1}",
    ]
    print("  " + "   ".join(header))
    print(paint("─" * terminal_width, DIM))
    if terminal_width >= 118:
        left_width = 25
        right_width = 34
        main_width = terminal_width - left_width - right_width - 6
        columns = [
            side_panel(server, left_width),
            conversation_panel(server, main_width),
            activity_panel(server, client, right_width),
        ]
        for row in zip_longest(*columns, fillvalue=""):
            print("  " + "  ".join(cell.ljust(size) for cell, size in zip(row, [left_width + 2, main_width + 2, right_width + 2])))
    else:
        print("\n".join(side_panel(server, terminal_width - 4)))
        print("\n".join(conversation_panel(server, terminal_width - 4)))
        print("\n".join(activity_panel(server, client, terminal_width - 4)))
    print()
    print(paint("─" * terminal_width, DIM))
    print(paint(f"LAST EVENT  {notice}", BOLD))
    print()
    for line in command_legend():
        print("  " + line)


def zip_longest(*iterables, fillvalue=None):
    iterators = [iter(item) for item in iterables]
    active = len(iterators)
    while active:
        row = []
        for iterator in iterators:
            try:
                row.append(next(iterator))
            except StopIteration:
                row.append(fillvalue)
        if all(item is fillvalue for item in row):
            break
        active = sum(item is not fillvalue for item in row)
        yield row


def demo_actions(mode):
    actions = [
        command("demo-project", "create_project", project_id="proj-demo", name="Release workspace"),
        command("demo-thread", "create_thread", thread_id="thread-demo", model="codex/demo", access_mode="workspace", interaction_mode="execute"),
        command("demo-turn", "start_turn", turn_id="turn-demo", prompt="Prepare the release checklist and identify risky changes."),
        command("demo-delta-1", "runtime_delta", event_id="demo-delta-1", delta="I’ll inspect the workspace and prepare a concise release checklist."),
        command("demo-activity-1", "runtime_activity", event_id="demo-activity-1", activity_id="activity-demo", activity_kind="workspace scan", summary="Inspecting project files"),
    ]
    if mode == "complete":
        actions += [
            command("demo-finish-activity", "finish_activity", activity_id="activity-demo", status="succeeded", summary="Workspace scan complete"),
            command("demo-delta-2", "runtime_delta", event_id="demo-delta-2", delta="The workspace is ready. I found no blocking changes."),
            command("demo-complete", "runtime_complete", event_id="demo-complete", final="Release checklist prepared; no blocking changes found."),
        ]
    else:
        actions.append(command("demo-approval", "runtime_approval", event_id="demo-approval", request_id="request-demo", operation="Run the release verification command"))
    return actions


def run_demo(state, mode):
    result = {"ok": True}
    notice = f"demo loaded: {mode}"
    for action in demo_actions(mode):
        state, result, notice = step(state, action)
    state, _, _ = step(state, {"type": "sync", "cursor": 0})
    return state, result, notice


def help_text():
    return "Use demo approval to inspect the paused-request mockup, or demo complete for the settled-turn mockup."


def main():
    state = initial_state()
    notice = "ready · try: demo approval"
    render(state, notice)
    for line in sys.stdin:
        try:
            action = parse(line.strip())
            if action is None:
                continue
            if action["type"] == "quit":
                return
            if action["type"] == "help":
                notice = help_text()
                render(state, notice)
                continue
            if action["type"] == "demo":
                state, result, notice = run_demo(initial_state(), action["mode"])
                print(f"\n{paint('Result', BOLD)}: {result}")
                render(state, notice)
                continue
            if action["type"] == "show":
                notice = "state rendered"
                render(state, notice)
                continue
            if action["type"] == "invalid":
                notice = action["message"]
                render(state, notice)
                continue
            state, result, notice = step(state, action)
            print(f"\n{paint('Result', BOLD)}: {result}")
            render(state, notice)
        except (IndexError, ValueError, KeyError) as error:
            notice = f"input error: {error}"
            render(state, notice)


if __name__ == "__main__":
    main()
