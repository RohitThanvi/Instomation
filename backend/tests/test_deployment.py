"""Structural checks on the deployment files. Docker is not available in every environment that runs
the tests, so these guard the properties that have actually broken before (e.g. a queue with no
worker, which silently stops a whole stage of the pipeline) without needing to start containers."""

import re
from pathlib import Path
from typing import Any

import pytest
import yaml

from app.config.settings import Settings
from app.workers.queues import QueueName

ROOT = Path(__file__).resolve().parents[2]
SECRETISH = re.compile(r"(KEY|SECRET|TOKEN|PASSWORD)", re.IGNORECASE)


@pytest.fixture(scope="module")
def compose() -> dict[str, Any]:
    loaded: dict[str, Any] = yaml.safe_load((ROOT / "docker-compose.yml").read_text())
    return loaded


def _workers(compose: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        name: service
        for name, service in compose["services"].items()
        if service.get("command", [None])[0] == "arq"
    }


def test_every_queue_has_exactly_one_worker_service(compose: dict[str, Any]) -> None:
    by_queue: dict[str, list[str]] = {}
    for name, service in _workers(compose).items():
        by_queue.setdefault(service["environment"]["WORKER_QUEUE"], []).append(name)
    assert sorted(by_queue) == sorted(queue.value for queue in QueueName)
    assert all(len(names) == 1 for names in by_queue.values()), by_queue


def test_workers_run_the_worker_settings_and_are_not_scaled_out(compose: dict[str, Any]) -> None:
    for name, service in _workers(compose).items():
        assert service["command"] == ["arq", "app.workers.settings.WorkerSettings"], name
        # maintenance runs cron sweepers; more than one replica would run every sweep twice
        assert service.get("deploy", {}).get("replicas", 1) == 1, name


def test_workers_have_a_liveness_check_and_wait_for_migrations_and_redis(
    compose: dict[str, Any],
) -> None:
    for name, service in _workers(compose).items():
        assert service["healthcheck"]["test"][-1] == "--check", name
        depends = service["depends_on"]
        assert depends["migrate"]["condition"] == "service_completed_successfully", name
        assert depends["redis"]["condition"] == "service_healthy", name


def test_migrations_run_once_before_the_api_and_workers(compose: dict[str, Any]) -> None:
    services = compose["services"]
    assert services["migrate"]["command"] == ["alembic", "upgrade", "head"]
    assert services["migrate"]["restart"] == "no"
    assert services["api"]["depends_on"]["migrate"]["condition"] == "service_completed_successfully"


def test_api_has_a_health_check(compose: dict[str, Any]) -> None:
    assert "/health" in " ".join(compose["services"]["api"]["healthcheck"]["test"])


def test_compose_holds_no_literal_secrets(compose: dict[str, Any]) -> None:
    for name, service in compose["services"].items():
        for key, value in (service.get("environment") or {}).items():
            if SECRETISH.search(key):
                assert str(value).startswith("${"), f"{name}.{key} must come from the environment"
    anchors = {k: v for k, v in compose.items() if k.startswith("x-")}
    for anchor in anchors.values():
        for key, value in (anchor.get("environment") or {}).items():
            if SECRETISH.search(key):
                assert str(value).startswith("${"), f"{key} must come from the environment"


def test_backend_image_does_not_run_as_root() -> None:
    dockerfile = (ROOT / "backend" / "Dockerfile").read_text()
    user_lines = [line for line in dockerfile.splitlines() if line.startswith("USER ")]
    assert user_lines and user_lines[-1] != "USER root"


def test_every_setting_is_documented_in_env_example() -> None:
    documented = set(
        re.findall(r"^#?\s*([A-Z][A-Z0-9_]+)=", (ROOT / ".env.example").read_text(), re.M)
    )
    missing = sorted(
        name.upper() for name in Settings.model_fields if name.upper() not in documented
    )
    assert missing == [], f"settings missing from .env.example: {missing}"


def test_env_example_documents_nothing_that_is_not_a_setting() -> None:
    documented = set(
        re.findall(r"^#?\s*([A-Z][A-Z0-9_]+)=", (ROOT / ".env.example").read_text(), re.M)
    )
    known = {name.upper() for name in Settings.model_fields}
    # variables read by compose / the frontend build rather than by the backend's Settings
    outside_backend = {"POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"}
    outside_backend |= {name for name in documented if name.startswith("VITE_")}
    unknown = sorted(documented - known - outside_backend)
    assert unknown == [], f".env.example documents unknown settings: {unknown}"
