from enum import StrEnum


class QueueName(StrEnum):
    """Independent queues so each workload scales (and fails) on its own."""

    EVENTS = "events"
    AI = "ai"
    INSTAGRAM = "instagram"
    MAINTENANCE = "maintenance"

    @property
    def redis_key(self) -> str:
        return f"instomation:queue:{self.value}"
