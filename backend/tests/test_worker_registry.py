"""The worker registry is matched to enqueued jobs *by function name*: arq looks up the string a job
was enqueued under and, if no registered function has that name, logs "function not found" forever
and never runs the job (this silently broke webhook processing once). These tests pin the exact
handler names per queue, so adding, renaming or dropping a handler is a deliberate, reviewed change.
"""

from app.services.automation.comment_reply import PRIVATE_SEND_FUNCTION
from app.services.automation.comment_reply import SEND_FUNCTION as COMMENT_SEND_FUNCTION
from app.workers.moderation import REPLY_FUNCTIONS
from app.workers.queues import QueueName
from app.workers.settings import _CRON_JOBS, HANDLERS

EXPECTED_HANDLERS: dict[QueueName, set[str]] = {
    QueueName.EVENTS: {"process_webhook_event"},
    QueueName.AI: {"moderate_message", "generate_dm_reply", "generate_comment_reply"},
    QueueName.INSTAGRAM: {"send_instagram_message", "send_comment_reply", "send_private_reply"},
}
EXPECTED_CRON: dict[QueueName, set[str]] = {
    QueueName.MAINTENANCE: {
        "cron:requeue_stale_jobs",
        "cron:purge_finished_records",
        "cron:refresh_instagram_tokens",
    },
}


def _names(queue: QueueName) -> list[str]:
    return [handler.__name__ for handler in HANDLERS.get(queue, [])]


def test_every_queue_registers_exactly_the_expected_handlers() -> None:
    assert {queue: set(_names(queue)) for queue in HANDLERS} == EXPECTED_HANDLERS


def test_no_queue_registers_the_same_function_twice() -> None:
    for queue in HANDLERS:
        names = _names(queue)
        assert len(names) == len(set(names)), f"duplicate handler on queue {queue.value}: {names}"


def test_every_queue_has_handlers_or_scheduled_work() -> None:
    for queue in QueueName:
        assert HANDLERS.get(queue) or _CRON_JOBS.get(queue), (
            f"queue {queue.value} has nothing registered, so its worker would refuse to start"
        )


def test_scheduled_jobs_are_exactly_the_expected_ones() -> None:
    assert {
        queue: {job.name for job in jobs} for queue, jobs in _CRON_JOBS.items()
    } == EXPECTED_CRON


def test_a_function_name_never_serves_two_queues() -> None:
    seen: dict[str, QueueName] = {}
    for queue in HANDLERS:
        for name in _names(queue):
            assert name not in seen, f"{name} is registered on both {seen[name]} and {queue}"
            seen[name] = queue


def test_chained_reply_jobs_are_registered_on_the_ai_queue() -> None:
    assert set(REPLY_FUNCTIONS.values()) <= set(_names(QueueName.AI))


def test_the_comment_send_job_is_registered_on_the_instagram_queue() -> None:
    assert COMMENT_SEND_FUNCTION in _names(QueueName.INSTAGRAM)


def test_the_private_reply_send_job_is_registered_on_the_instagram_queue() -> None:
    assert PRIVATE_SEND_FUNCTION in _names(QueueName.INSTAGRAM)
