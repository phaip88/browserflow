from __future__ import annotations

import pytest
from browserflow.domain.enums import ExecutionStatus, NodeExecutionStatus
from browserflow.domain.errors import BrowserFlowError
from browserflow.domain.state_machine import ExecutionStateMachine, NodeStateMachine

pytestmark = pytest.mark.unit


def test_happy_path_transitions() -> None:
    sm = ExecutionStateMachine
    path = [
        ExecutionStatus.CREATED,
        ExecutionStatus.VALIDATING,
        ExecutionStatus.QUEUED,
        ExecutionStatus.LEASED,
        ExecutionStatus.STARTING,
        ExecutionStatus.RUNNING,
        ExecutionStatus.SUCCEEDED,
    ]
    from itertools import pairwise

    for src, dst in pairwise(path):
        sm.assert_transition(src, dst)


def test_illegal_transition_raises() -> None:
    with pytest.raises(BrowserFlowError):
        ExecutionStateMachine.assert_transition(ExecutionStatus.SUCCEEDED, ExecutionStatus.RUNNING)


def test_worker_lost_can_requeue() -> None:
    ExecutionStateMachine.assert_transition(ExecutionStatus.WORKER_LOST, ExecutionStatus.QUEUED)


def test_terminal_detection() -> None:
    assert ExecutionStateMachine.is_terminal(ExecutionStatus.FAILED)
    assert not ExecutionStateMachine.is_terminal(ExecutionStatus.RUNNING)


def test_node_skip_from_pending() -> None:
    NodeStateMachine.assert_transition(NodeExecutionStatus.PENDING, NodeExecutionStatus.SKIPPED)
    NodeStateMachine.assert_transition(NodeExecutionStatus.PENDING, NodeExecutionStatus.NOT_REACHED)


def test_node_cannot_revive() -> None:
    with pytest.raises(BrowserFlowError):
        NodeStateMachine.assert_transition(
            NodeExecutionStatus.SUCCEEDED, NodeExecutionStatus.RUNNING
        )
