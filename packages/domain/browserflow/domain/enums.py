from __future__ import annotations

from enum import StrEnum


class Locale(StrEnum):
    EN = "en"
    ZH = "zh"


class AuthMode(StrEnum):
    AUTHENTICATED = "authenticated"
    LOCAL_UNAUTHENTICATED = "local_unauthenticated"


class FlowStatus(StrEnum):
    ACTIVE = "active"
    ARCHIVED = "archived"


class ExecutionStatus(StrEnum):
    CREATED = "CREATED"
    VALIDATING = "VALIDATING"
    QUEUED = "QUEUED"
    LEASED = "LEASED"
    STARTING = "STARTING"
    RUNNING = "RUNNING"
    WAITING_FOR_INPUT = "WAITING_FOR_INPUT"
    CANCELLING = "CANCELLING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    TIMED_OUT = "TIMED_OUT"
    WORKER_LOST = "WORKER_LOST"


class NodeExecutionStatus(StrEnum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"
    NOT_REACHED = "NOT_REACHED"
    CANCELLED = "CANCELLED"
    TIMED_OUT = "TIMED_OUT"


class EdgeKind(StrEnum):
    SUCCESS = "SUCCESS"
    TRUE = "TRUE"
    FALSE = "FALSE"
    ERROR = "ERROR"
    LOOP_BODY = "LOOP_BODY"
    LOOP_DONE = "LOOP_DONE"
    FINALLY = "FINALLY"


class ErrorPolicy(StrEnum):
    FAIL_FLOW = "FAIL_FLOW"
    FOLLOW_ERROR_EDGE = "FOLLOW_ERROR_EDGE"
    CONTINUE = "CONTINUE"
    USE_DEFAULT_VALUE = "USE_DEFAULT_VALUE"


class RetryBackoff(StrEnum):
    NONE = "NONE"
    FIXED = "FIXED"
    LINEAR = "LINEAR"
    EXPONENTIAL = "EXPONENTIAL"


class SideEffectLevel(StrEnum):
    NONE = "NONE"
    READ = "READ"
    WRITE = "WRITE"
    EXTERNAL = "EXTERNAL"


class CredentialKind(StrEnum):
    PASSWORD = "password"
    SECRET = "secret"
    USERNAME_PASSWORD = "username_password"
    TOKEN = "token"
    HEADER_MAP = "header_map"


class WorkerStatus(StrEnum):
    STARTING = "starting"
    READY = "ready"
    BUSY = "busy"
    DRAINING = "draining"
    LOST = "lost"
    STOPPED = "stopped"


class IdentityLockState(StrEnum):
    FREE = "free"
    LOCKED = "locked"


class ScheduleKind(StrEnum):
    CRON = "cron"
    ONCE = "once"


class MisfirePolicy(StrEnum):
    SKIP = "SKIP"
    RUN_ONCE = "RUN_ONCE"
    CATCH_UP_LIMITED = "CATCH_UP_LIMITED"


class OverlapPolicy(StrEnum):
    SKIP = "SKIP"
    QUEUE = "QUEUE"
    REPLACE = "REPLACE"


class ArtifactKind(StrEnum):
    SCREENSHOT = "screenshot"
    DOWNLOAD = "download"
    FILE = "file"
    LOG = "log"
    TRACE = "trace"


class AuditAction(StrEnum):
    ADMIN_INIT = "admin.init"
    LOGIN_SUCCESS = "auth.login.success"
    LOGIN_FAILURE = "auth.login.failure"
    LOGOUT = "auth.logout"
    PASSWORD_CHANGE = "auth.password.change"
    PASSWORD_RESET = "auth.password.reset"
    SESSION_REVOKE = "auth.session.revoke"
    FLOW_CREATE = "flow.create"
    FLOW_UPDATE = "flow.update"
    FLOW_PUBLISH = "flow.publish"
    FLOW_DELETE = "flow.delete"
    FLOW_ARCHIVE = "flow.archive"
    FLOW_IMPORT = "flow.import"
    FLOW_EXPORT = "flow.export"
    EXECUTION_START = "execution.start"
    EXECUTION_CANCEL = "execution.cancel"
    CREDENTIAL_CREATE = "credential.create"
    CREDENTIAL_UPDATE = "credential.update"
    CREDENTIAL_DELETE = "credential.delete"
    IDENTITY_CREATE = "identity.create"
    IDENTITY_DELETE = "identity.delete"
    SCHEDULE_CREATE = "schedule.create"
    SCHEDULE_UPDATE = "schedule.update"
    SETTING_UPDATE = "setting.update"
