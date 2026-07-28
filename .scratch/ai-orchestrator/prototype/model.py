"""THROWAWAY PROTOTYPE

Question: does one server-authoritative state model cleanly express durable command
idempotency, streamed runtime updates, approval/input pauses, interruption, and
bounded reconnect recovery without allowing stale or duplicate client state?

This module is intentionally dependency-free and in-memory. The pure `step`
function is the part worth carrying into the real orchestration engine if the
interaction model feels right; the terminal shell is disposable.
"""

from copy import deepcopy

RETENTION = 8


def initial_state():
    return {
        "server": {
            "project": None,
            "thread": None,
            "session_status": "none",
            "turn": None,
            "messages": [],
            "activities": [],
            "pending_request": None,
            "events": [],
            "next_sequence": 1,
            "receipts": {},
            "runtime_event_ids": [],
        },
        "client": {
            "last_sequence": 0,
            "sync_mode": "empty",
            "project": None,
            "thread": None,
            "session_status": "none",
            "turn": None,
            "messages": [],
            "activities": [],
            "pending_request": None,
        },
    }


def _projection(server):
    return {
        "project": deepcopy(server["project"]),
        "thread": deepcopy(server["thread"]),
        "session_status": server["session_status"],
        "turn": deepcopy(server["turn"]),
        "messages": deepcopy(server["messages"]),
        "activities": deepcopy(server["activities"]),
        "pending_request": deepcopy(server["pending_request"]),
    }


def _event(server, kind, data):
    sequence = server["next_sequence"]
    server["next_sequence"] += 1
    item = {"sequence": sequence, "kind": kind, "data": deepcopy(data)}
    server["events"].append(item)
    if len(server["events"]) > RETENTION:
        del server["events"][:-RETENTION]
    return item


def _find(items, key, value):
    return next((item for item in items if item[key] == value), None)


def _apply(target, event):
    kind = event["kind"]
    data = event["data"]

    if kind == "ProjectCreated":
        target["project"] = data
    elif kind == "ThreadCreated":
        target["thread"] = data
        target["session_status"] = "ready"
    elif kind == "ThreadArchived":
        target["thread"]["status"] = "archived"
    elif kind == "ThreadSettled":
        target["thread"]["status"] = "settled"
    elif kind == "ThreadDeleted":
        target["thread"]["status"] = "deleted"
    elif kind == "SessionRunning":
        target["session_status"] = "running"
    elif kind == "SessionStopped":
        target["session_status"] = "stopped"
    elif kind == "TurnQueued":
        target["turn"] = {
            "id": data["turn_id"],
            "status": "queued",
            "prompt": data["prompt"],
            "final": None,
        }
    elif kind == "UserMessageAdded":
        target["messages"].append(data)
    elif kind == "TurnRunning":
        target["turn"]["status"] = "running"
        target["session_status"] = "running"
    elif kind == "AssistantDelta":
        message = _find(target["messages"], "id", data["message_id"])
        if message is None:
            target["messages"].append(
                {"id": data["message_id"], "role": "assistant", "content": data["delta"]}
            )
        else:
            message["content"] += data["delta"]
    elif kind == "ActivityStarted":
        target["activities"].append(
            {
                "id": data["activity_id"],
                "kind": data["activity_kind"],
                "status": "running",
                "summary": data["summary"],
            }
        )
    elif kind == "ActivityFinished":
        activity = _find(target["activities"], "id", data["activity_id"])
        if activity is not None:
            activity["status"] = data["status"]
            activity["summary"] = data["summary"]
    elif kind == "ApprovalRequested":
        target["pending_request"] = {
            "id": data["request_id"],
            "kind": "approval",
            "operation": data["operation"],
            "fields": [],
            "status": "pending",
        }
        target["turn"]["status"] = "waiting_approval"
    elif kind == "InputRequested":
        target["pending_request"] = {
            "id": data["request_id"],
            "kind": "input",
            "operation": data["operation"],
            "fields": data["fields"],
            "status": "pending",
        }
        target["turn"]["status"] = "waiting_input"
    elif kind == "PendingRequestResolved":
        target["pending_request"]["status"] = data["decision"]
        target["pending_request"] = None
    elif kind == "TurnCompleted":
        target["turn"]["status"] = "completed"
        target["turn"]["final"] = data["final"]
        target["session_status"] = "ready"
    elif kind == "TurnInterrupted":
        target["turn"]["status"] = "interrupted"
        target["turn"]["final"] = data["reason"]
        target["session_status"] = "ready"
        target["pending_request"] = None
    elif kind == "TurnFailed":
        target["turn"]["status"] = "failed"
        target["turn"]["final"] = data["error"]
        target["session_status"] = "ready"
        target["pending_request"] = None


def _commit(server, command_id, events, result):
    for event in events:
        _apply(server, _event(server, event["kind"], event["data"]))
    server["receipts"][command_id] = {
        "result": deepcopy(result),
        "sequences": [event["sequence"] for event in server["events"][-len(events) :]] if events else [],
    }
    return result


def _reject(server, command_id, code, detail):
    result = {"ok": False, "code": code, "detail": detail}
    server["receipts"][command_id] = {"result": deepcopy(result), "sequences": []}
    return result


def _command(server, command_id, kind, payload):
    if command_id in server["receipts"]:
        return {"ok": True, "duplicate": True, **deepcopy(server["receipts"][command_id]["result"])}

    if kind in {"runtime_delta", "runtime_activity", "runtime_approval", "runtime_input", "runtime_complete", "runtime_error"}:
        runtime_event_id = payload["event_id"]
        if runtime_event_id in server["runtime_event_ids"]:
            result = {"ok": True, "duplicate_runtime_event": True, "event_id": runtime_event_id}
            server["receipts"][command_id] = {"result": deepcopy(result), "sequences": []}
            return result
        server["runtime_event_ids"].append(runtime_event_id)

    thread = server["thread"]
    turn = server["turn"]

    if kind == "create_project":
        if server["project"] is not None:
            return _reject(server, command_id, "project_exists", "Only one prototype project is supported")
        return _commit(server, command_id, [{
            "kind": "ProjectCreated",
            "data": {"id": payload["project_id"], "name": payload["name"], "status": "active"},
        }], {"ok": True, "project_id": payload["project_id"]})

    if kind == "create_thread":
        if server["project"] is None:
            return _reject(server, command_id, "missing_project", "Create a project first")
        if thread is not None:
            return _reject(server, command_id, "thread_exists", "Only one prototype thread is supported")
        return _commit(server, command_id, [{
            "kind": "ThreadCreated",
            "data": {
                "id": payload["thread_id"],
                "project_id": server["project"]["id"],
                "status": "active",
                "model": payload["model"],
                "access_mode": payload["access_mode"],
                "interaction_mode": payload["interaction_mode"],
            },
        }], {"ok": True, "thread_id": payload["thread_id"]})

    if kind in {"archive_thread", "settle_thread", "delete_thread"}:
        if thread is None:
            return _reject(server, command_id, "missing_thread", "Create a thread first")
        transitions = {
            "archive_thread": ("active", "ThreadArchived", "archived"),
            "settle_thread": (("active", "archived"), "ThreadSettled", "settled"),
            "delete_thread": (("active", "archived", "settled"), "ThreadDeleted", "deleted"),
        }
        allowed, event_kind, status = transitions[kind]
        allowed = (allowed,) if isinstance(allowed, str) else allowed
        if thread["status"] not in allowed:
            return _reject(server, command_id, "invalid_thread_transition", f"Cannot move {thread['status']} to {status}")
        return _commit(server, command_id, [{"kind": event_kind, "data": {}}], {"ok": True, "thread_status": status})

    if kind == "start_turn":
        if thread is None or thread["status"] != "active":
            return _reject(server, command_id, "invalid_thread", "Turn requires an active thread")
        if turn is not None and turn["status"] in {"queued", "running", "waiting_approval", "waiting_input"}:
            return _reject(server, command_id, "turn_in_progress", "Resolve or interrupt the current turn first")
        turn_id = payload["turn_id"]
        events = [
            {"kind": "TurnQueued", "data": {"turn_id": turn_id, "prompt": payload["prompt"]}},
            {"kind": "UserMessageAdded", "data": {"id": f"user-{turn_id}", "role": "user", "content": payload["prompt"]}},
            {"kind": "TurnRunning", "data": {"turn_id": turn_id}},
        ]
        return _commit(server, command_id, events, {"ok": True, "turn_id": turn_id, "status": "running"})

    if kind == "runtime_delta":
        if turn is None or turn["status"] != "running":
            return _reject(server, command_id, "invalid_turn_state", "Assistant deltas require a running turn")
        return _commit(server, command_id, [{
            "kind": "AssistantDelta",
            "data": {"message_id": f"assistant-{turn['id']}", "delta": payload["delta"]},
        }], {"ok": True, "status": "running"})

    if kind == "runtime_activity":
        if turn is None or turn["status"] != "running":
            return _reject(server, command_id, "invalid_turn_state", "Activities require a running turn")
        return _commit(server, command_id, [{
            "kind": "ActivityStarted",
            "data": {"activity_id": payload["activity_id"], "activity_kind": payload["activity_kind"], "summary": payload["summary"]},
        }], {"ok": True, "activity_id": payload["activity_id"]})

    if kind == "finish_activity":
        activity = _find(server["activities"], "id", payload["activity_id"])
        if activity is None:
            return _reject(server, command_id, "missing_activity", "Activity does not exist")
        return _commit(server, command_id, [{
            "kind": "ActivityFinished",
            "data": {"activity_id": payload["activity_id"], "status": payload["status"], "summary": payload["summary"]},
        }], {"ok": True, "activity_id": payload["activity_id"], "status": payload["status"]})

    if kind in {"runtime_approval", "runtime_input"}:
        if turn is None or turn["status"] != "running" or server["pending_request"] is not None:
            return _reject(server, command_id, "request_not_allowed", "A running turn must have no other pending request")
        event_kind = "ApprovalRequested" if kind == "runtime_approval" else "InputRequested"
        data = {
            "event_id": payload["event_id"],
            "request_id": payload["request_id"],
            "operation": payload["operation"],
            "fields": payload.get("fields", []),
        }
        return _commit(server, command_id, [{"kind": event_kind, "data": data}], {"ok": True, "request_id": payload["request_id"], "status": "pending"})

    if kind in {"respond_approval", "respond_input"}:
        pending = server["pending_request"]
        expected_kind = "approval" if kind == "respond_approval" else "input"
        if pending is None or pending["id"] != payload["request_id"] or pending["kind"] != expected_kind:
            return _reject(server, command_id, "stale_request", "The request is absent, resolved, or belongs to another kind")
        decision = payload.get("decision", "answered")
        return _commit(server, command_id, [{
            "kind": "PendingRequestResolved",
            "data": {"request_id": pending["id"], "decision": decision},
        }, {"kind": "TurnRunning", "data": {"turn_id": turn["id"]}}], {"ok": True, "request_id": pending["id"], "status": "running"})

    if kind == "runtime_complete":
        if turn is None or turn["status"] != "running" or server["pending_request"] is not None:
            return _reject(server, command_id, "invalid_completion", "Completion requires a running turn with no pending request")
        return _commit(server, command_id, [{"kind": "TurnCompleted", "data": {"final": payload["final"]}}], {"ok": True, "status": "completed"})

    if kind == "interrupt_turn":
        if turn is None or turn["status"] not in {"queued", "running", "waiting_approval", "waiting_input"}:
            return _reject(server, command_id, "invalid_interrupt", "Only an active turn can be interrupted")
        return _commit(server, command_id, [{"kind": "TurnInterrupted", "data": {"reason": payload["reason"]}}], {"ok": True, "status": "interrupted"})

    if kind == "stop_session":
        if server["session_status"] not in {"running", "ready"}:
            return _reject(server, command_id, "invalid_session", "No provider session can be stopped")
        events = [{"kind": "SessionStopped", "data": {}}]
        if turn is not None and turn["status"] in {"queued", "running", "waiting_approval", "waiting_input"}:
            events.append({"kind": "TurnInterrupted", "data": {"reason": "session_stopped"}})
        return _commit(server, command_id, events, {"ok": True, "status": "stopped"})

    return _reject(server, command_id, "unknown_command", kind)


def _sync(state, cursor):
    server = state["server"]
    client = state["client"]
    latest = server["next_sequence"] - 1
    if cursor == latest:
        client["sync_mode"] = "up_to_date"
        return {"ok": True, "mode": "up_to_date", "sequence": latest}

    if not server["events"]:
        client.update(_projection(server), last_sequence=latest, sync_mode="snapshot")
        return {"ok": True, "mode": "snapshot", "sequence": latest}

    oldest = server["events"][0]["sequence"]
    replay = [event for event in server["events"] if event["sequence"] > cursor]
    if cursor < oldest - 1 or not replay or replay[0]["sequence"] != cursor + 1:
        client.update(_projection(server), last_sequence=latest, sync_mode="snapshot")
        return {"ok": True, "mode": "snapshot", "sequence": latest, "reason": "replay_unavailable"}

    for event in replay:
        if event["sequence"] > client["last_sequence"]:
            _apply(client, event)
            client["last_sequence"] = event["sequence"]
    client["sync_mode"] = "replay"
    return {"ok": True, "mode": "replay", "from": cursor, "to": latest, "events": len(replay)}


def step(state, action):
    """Pure state transition. Returns (new_state, result, notice)."""
    next_state = deepcopy(state)
    if action["type"] == "sync":
        result = _sync(next_state, action["cursor"])
        return next_state, result, f"client sync: {result['mode']}"
    if action["type"] == "command":
        result = _command(next_state["server"], action["command_id"], action["kind"], action["payload"])
        return next_state, result, f"command {action['command_id']}: {result.get('code', result.get('status', 'accepted'))}"
    return next_state, {"ok": False, "code": "unknown_action"}, "unknown action"
