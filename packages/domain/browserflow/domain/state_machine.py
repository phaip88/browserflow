from __future__ import annotations

from browserflow.domain.enums import ExecutionStatus, NodeExecutionStatus
from browserflow.domain.errors import BrowserFlowError, ErrorCode

TERMINAL_EXECUTION_STATUSES: frozenset[ExecutionStatus] = frozenset(
    {
        ExecutionStatus.SUCCEEDED,
        ExecutionStatus.FAILED,
        ExecutionStatus.CANCELLED,
        ExecutionStatus.TIMED_OUT,
    }
)

_EXECUTION_TRANSITIONS: dict[ExecutionStatus, frozenset[ExecutionStatus]] = {
    ExecutionStatus.CREATED: frozenset(
        {ExecutionStatus.VALIDATING, ExecutionStatus.CANCELLED, ExecutionStatus.FAILED}
    ),
    ExecutionStatus.VALIDATING: frozenset(
        {ExecutionStatus.QUEUED, ExecutionStatus.FAILED, ExecutionStatus.CANCELLED}
    ),
    ExecutionStatus.QUEUED: frozenset(
        {ExecutionStatus.LEASED, ExecutionStatus.CANCELLED, ExecutionStatus.TIMED_OUT}
    ),
    ExecutionStatus.LEASED: frozenset(
        {
            ExecutionStatus.STARTING,
            ExecutionStatus.QUEUED,
            ExecutionStatus.CANCELLED,
            ExecutionStatus.WORKER_LOST,
        }
    ),
    ExecutionStatus.STARTING: frozenset(
        {
            ExecutionStatus.RUNNING,
            ExecutionStatus.FAILED,
            ExecutionStatus.CANCELLED,
            ExecutionStatus.WORKER_LOST,
            ExecutionStatus.TIMED_OUT,
        }
    ),
    ExecutionStatus.RUNNING: frozenset(
        {
            ExecutionStatus.SUCCEEDED,
            ExecutionStatus.FAILED,
            ExecutionStatus.CANCELLING,
            ExecutionStatus.TIMED_OUT,
            ExecutionStatus.WORKER_LOST,
            ExecutionStatus.WAITING_FOR_INPUT,
        }
    ),
    ExecutionStatus.WAITING_FOR_INPUT: frozenset(
        {
            ExecutionStatus.RUNNING,
            ExecutionStatus.CANCELLING,
            ExecutionStatus.TIMED_OUT,
            ExecutionStatus.CANCELLED,
            ExecutionStatus.WORKER_LOST,
        }
    ),
    ExecutionStatus.CANCELLING: frozenset(
        {
            ExecutionStatus.CANCELLED,
            ExecutionStatus.WORKER_LOST,
            ExecutionStatus.TIMED_OUT,
        }
    ),
    ExecutionStatus.WORKER_LOST: frozenset(
        {
            ExecutionStatus.QUEUED,
            ExecutionStatus.FAILED,
            ExecutionStatus.CANCELLED,
            ExecutionStatus.TIMED_OUT,
        }
    ),
    ExecutionStatus.SUCCEEDED: frozenset(),
    ExecutionStatus.FAILED: frozenset(),
    ExecutionStatus.CANCELLED: frozenset(),
    ExecutionStatus.TIMED_OUT: frozenset(),
}

_NODE_TRANSITIONS: dict[NodeExecutionStatus, frozenset[NodeExecutionStatus]] = {
    NodeExecutionStatus.PENDING: frozenset(
        {
            NodeExecutionStatus.RUNNING,
            NodeExecutionStatus.SKIPPED,
            NodeExecutionStatus.NOT_REACHED,
            NodeExecutionStatus.CANCELLED,
        }
    ),
    NodeExecutionStatus.RUNNING: frozenset(
        {
            NodeExecutionStatus.SUCCEEDED,
            NodeExecutionStatus.FAILED,
            NodeExecutionStatus.CANCELLED,
            NodeExecutionStatus.TIMED_OUT,
        }
    ),
    NodeExecutionStatus.SUCCEEDED: frozenset(),
    NodeExecutionStatus.FAILED: frozenset(),
    NodeExecutionStatus.SKIPPED: frozenset(),
    NodeExecutionStatus.NOT_REACHED: frozenset(),
    NodeExecutionStatus.CANCELLED: frozenset(),
    NodeExecutionStatus.TIMED_OUT: frozenset(),
}

TERMINAL_NODE_STATUSES: frozenset[NodeExecutionStatus] = frozenset(
    {
        NodeExecutionStatus.SUCCEEDED,
        NodeExecutionStatus.FAILED,
        NodeExecutionStatus.SKIPPED,
        NodeExecutionStatus.NOT_REACHED,
        NodeExecutionStatus.CANCELLED,
        NodeExecutionStatus.TIMED_OUT,
    }
)


class ExecutionStateMachine:
    @staticmethod
    def can_transition(current: ExecutionStatus, target: ExecutionStatus) -> bool:
        if current == target:
            return True
        return target in _EXECUTION_TRANSITIONS.get(current, frozenset())

    @staticmethod
    def assert_transition(current: ExecutionStatus, target: ExecutionStatus) -> None:
        if current == target:
            return
        allowed = _EXECUTION_TRANSITIONS.get(current, frozenset())
        if target not in allowed:
            raise BrowserFlowError(
                ErrorCode.STATE,
                f"illegal execution transition {current} -> {target}",
                details={"from": current, "to": target},
            )

    @staticmethod
    def is_terminal(status: ExecutionStatus) -> bool:
        return status in TERMINAL_EXECUTION_STATUSES

    @staticmethod
    def allows_worker_update(status: ExecutionStatus) -> bool:
        return status in {
            ExecutionStatus.LEASED,
            ExecutionStatus.STARTING,
            ExecutionStatus.RUNNING,
            ExecutionStatus.WAITING_FOR_INPUT,
            ExecutionStatus.CANCELLING,
        }


class NodeStateMachine:
    @staticmethod
    def can_transition(current: NodeExecutionStatus, target: NodeExecutionStatus) -> bool:
        if current == target:
            return True
        return target in _NODE_TRANSITIONS.get(current, frozenset())

    @staticmethod
    def assert_transition(current: NodeExecutionStatus, target: NodeExecutionStatus) -> None:
        if current == target:
            return
        allowed = _NODE_TRANSITIONS.get(current, frozenset())
        if target not in allowed:
            raise BrowserFlowError(
                ErrorCode.STATE,
                f"illegal node transition {current} -> {target}",
                details={"from": current, "to": target},
            )

    @staticmethod
    def is_terminal(status: NodeExecutionStatus) -> bool:
        return status in TERMINAL_NODE_STATUSES
