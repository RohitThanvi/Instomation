import logging
import sys

import structlog


def configure_logging(level: str) -> None:
    """Emit structured JSON logs; request-scoped context is merged via contextvars."""
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=level)
    # httpx logs full request URLs at INFO, and some Meta endpoints take tokens as query params.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(level)),
        cache_logger_on_first_use=True,
    )
