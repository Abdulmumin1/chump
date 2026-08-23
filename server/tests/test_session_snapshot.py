import json
import sqlite3

from chump_server.server.session_snapshot import (
    reconcile_delegated_session_lifecycles,
    reconcile_delegated_session_snapshot,
)


def _event(event_id: int, event_type: str, data: dict) -> dict:
    return {"id": event_id, "type": event_type, "data": data}


def _store_child_state(db_path, session_id: str, status: str, error=None) -> None:
    with sqlite3.connect(db_path) as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT)")
        conn.execute(
            "INSERT INTO kv_store (key, value) VALUES (?, ?)",
            (
                f"{session_id}:state",
                json.dumps(
                    {
                        "delegated_task_status": status,
                        "delegated_task_error": error,
                    }
                ),
            ),
        )


def test_reconciles_orphaned_start_session_from_terminal_child_state(tmp_path):
    db_path = tmp_path / "chump.sqlite3"
    _store_child_state(db_path, "issue-227", "completed")
    events = [
        _event(
            606,
            "tool_call",
            {
                "name": "start_session",
                "call_id": "start-227",
                "args": {"session_id": "issue-227"},
                "step": 5,
                "index": 0,
            },
        )
    ]

    reconciled = reconcile_delegated_session_lifecycles(db_path, events)

    assert events == [events[0]]
    assert reconciled[-1] == {
        "id": 606,
        "type": "tool_result",
        "data": {
            "tool": "start_session",
            "name": "start_session",
            "tool_name": "start_session",
            "call_id": "start-227",
            "tool_call_id": "start-227",
            "step": 5,
            "index": 0,
            "ok": True,
            "status": "ok",
            "is_error": False,
            "aborted": False,
            "preview": json.dumps(
                {
                    "session_id": "issue-227",
                    "delegated_task_status": "completed",
                }
            ),
            "metadata": {
                "delegated_task_status": "completed",
                "reconciled_from_child_session": True,
            },
            "schema_version": 1,
        },
    }


def test_reconciles_generated_child_from_durable_parent_link_without_event(tmp_path):
    db_path = tmp_path / "chump.sqlite3"
    _store_child_state(db_path, "generated-child", "aborted", "cancelled")
    durable_links = {
        "generated-start": {
            "session_id": "generated-child",
            "event_id": 40,
            "step": 5,
            "index": 0,
        }
    }

    reconciled = reconcile_delegated_session_lifecycles(
        db_path,
        [],
        durable_links,
    )

    assert [event["type"] for event in reconciled] == ["tool_call", "tool_result"]
    assert reconciled[0]["data"]["call_id"] == "generated-start"
    assert reconciled[0]["data"]["args"] == {"session_id": "generated-child"}
    assert reconciled[1]["data"]["aborted"] is True
    assert "generated-child" in reconciled[1]["data"]["preview"]


def test_projects_generated_child_link_while_child_is_active(tmp_path):
    db_path = tmp_path / "chump.sqlite3"
    _store_child_state(db_path, "generated-child", "running")
    durable_links = {
        "generated-start": {
            "session_id": "generated-child",
            "event_id": 40,
            "step": 5,
            "index": 0,
        }
    }

    reconciled = reconcile_delegated_session_lifecycles(
        db_path,
        [],
        durable_links,
    )

    assert len(reconciled) == 1
    assert reconciled[0]["type"] == "tool_call"
    assert reconciled[0]["data"]["call_id"] == "generated-start"


def test_preserves_failed_child_status_and_error(tmp_path):
    db_path = tmp_path / "chump.sqlite3"
    _store_child_state(db_path, "issue-228", "failed", "provider overloaded")
    events = [
        _event(
            10,
            "tool_call",
            {
                "name": "start_session",
                "call_id": "start-228",
                "args": {"session_id": "issue-228"},
                "step": 5,
                "index": 0,
            },
        )
    ]

    reconciled = reconcile_delegated_session_lifecycles(db_path, events)

    assert reconciled[-1]["data"]["status"] == "error"
    assert reconciled[-1]["data"]["error"] == "provider overloaded"
    assert reconciled[-1]["data"]["metadata"]["delegated_task_status"] == "failed"


def test_preserves_aborted_child_status(tmp_path):
    db_path = tmp_path / "chump.sqlite3"
    _store_child_state(db_path, "issue-aborted", "aborted", "delegated task cancelled")
    events = [
        _event(
            15,
            "tool_call",
            {
                "name": "start_session",
                "call_id": "start-aborted",
                "args": {"session_id": "issue-aborted"},
                "step": 5,
                "index": 0,
            },
        )
    ]

    reconciled = reconcile_delegated_session_lifecycles(db_path, events)

    assert reconciled[-1]["data"]["status"] == "error"
    assert reconciled[-1]["data"]["aborted"] is True
    assert reconciled[-1]["data"]["ok"] is False


def test_does_not_settle_an_active_child(tmp_path):
    db_path = tmp_path / "chump.sqlite3"
    _store_child_state(db_path, "issue-229", "running")
    events = [
        _event(
            20,
            "tool_call",
            {
                "name": "start_session",
                "call_id": "start-229",
                "args": {"session_id": "issue-229"},
                "step": 5,
                "index": 0,
            },
        )
    ]

    assert reconcile_delegated_session_lifecycles(db_path, events) is events


def test_does_not_duplicate_an_existing_parent_result(tmp_path):
    db_path = tmp_path / "chump.sqlite3"
    _store_child_state(db_path, "issue-230", "completed")
    events = [
        _event(
            30,
            "tool_call",
            {
                "name": "start_session",
                "call_id": "start-230",
                "args": {"session_id": "issue-230"},
                "step": 5,
                "index": 0,
            },
        ),
        _event(
            31,
            "tool_result",
            {
                "name": "start_session",
                "call_id": "start-230",
                "status": "ok",
            },
        ),
    ]

    assert reconcile_delegated_session_lifecycles(db_path, events) is events


def test_snapshot_projects_terminal_lifecycle_into_messages_and_closes_idle_tail(
    tmp_path,
):
    db_path = tmp_path / "chump.sqlite3"
    _store_child_state(db_path, "issue-227", "completed")
    snapshot = {
        "status": {"turn_running": False, "steering_queue": []},
        "messages": [{"role": "user", "content": "delegate work"}],
        "events": [
            _event(1, "turn_status", {"running": True, "steering_queue": []}),
            _event(
                606,
                "tool_call",
                {
                    "name": "start_session",
                    "call_id": "start-227",
                    "args": {"session_id": "issue-227"},
                    "step": 5,
                    "index": 0,
                },
            ),
        ],
    }

    reconciled = reconcile_delegated_session_snapshot(db_path, snapshot)

    assert reconciled["events"][-1]["type"] == "turn_status"
    assert reconciled["events"][-1]["data"]["running"] is False
    assert reconciled["events"][-1]["id"] == 606
    assert reconciled["messages"][-2]["content"][0]["tool_call"]["id"] == "start-227"
    result = reconciled["messages"][-1]["content"][0]["tool_result"]
    assert result["tool_call_id"] == "start-227"
    assert result["status"] == "completed"


def test_snapshot_projects_durable_execution_finished_into_messages(tmp_path):
    db_path = tmp_path / "chump.sqlite3"
    snapshot = {
        "status": {"turn_running": False, "steering_queue": []},
        "messages": [{"role": "user", "content": "delegate work"}],
        "events": [
            _event(1, "turn_status", {"running": True, "steering_queue": []}),
            _event(
                7336,
                "tool_call",
                {
                    "name": "start_session",
                    "call_id": "start-227",
                    "args": {"session_id": "issue-227"},
                    "step": 5,
                    "index": 0,
                },
            ),
            _event(
                7440,
                "tool_execution.finished",
                {
                    "name": "start_session",
                    "call_id": "start-227",
                    "step": 5,
                    "index": 0,
                    "ok": True,
                    "status": "ok",
                    "preview": json.dumps(
                        {
                            "session_id": "issue-227",
                            "delegated_task_status": "completed",
                        }
                    ),
                    "metadata": {"delegated_task_status": "completed"},
                },
            ),
            _event(7441, "turn_status", {"running": False, "steering_queue": []}),
        ],
    }

    reconciled = reconcile_delegated_session_snapshot(db_path, snapshot)

    assert reconciled["events"] == snapshot["events"]
    assert reconciled["messages"][-2]["content"][0]["tool_call"]["id"] == "start-227"
    result = reconciled["messages"][-1]["content"][0]["tool_result"]
    assert result["tool_call_id"] == "start-227"
    assert result["status"] == "completed"
    assert "issue-227" in result["result"]


def test_snapshot_keeps_unfinished_turn_when_another_tool_is_pending(tmp_path):
    db_path = tmp_path / "chump.sqlite3"
    _store_child_state(db_path, "issue-227", "completed")
    snapshot = {
        "status": {"turn_running": False, "steering_queue": []},
        "messages": [],
        "events": [
            _event(1, "turn_status", {"running": True, "steering_queue": []}),
            _event(
                2,
                "tool_call",
                {
                    "name": "start_session",
                    "call_id": "start-227",
                    "args": {"session_id": "issue-227"},
                    "step": 5,
                    "index": 0,
                },
            ),
            _event(
                3,
                "tool_call",
                {
                    "name": "bash",
                    "call_id": "still-pending",
                    "args": {"command": "sleep 10"},
                    "step": 5,
                    "index": 1,
                },
            ),
        ],
    }

    reconciled = reconcile_delegated_session_snapshot(db_path, snapshot)

    assert reconciled["events"][-1]["type"] == "tool_result"
    assert reconciled["events"][-1]["data"]["call_id"] == "start-227"
