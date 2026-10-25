"""Structural checks on the deployment files. Docker is not available in every environment that runs
the tests, so these guard the properties that have actually broken before (e.g. a queue with no
worker, which silently stops a whole stage of the pipeline) without needing to start containers."""

import re
from pathlib import Path
from typing import Any

import pytest
import yaml
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

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


def _location_blocks(conf: str) -> list[str]:
    """The body of every `location { ... }` block (none of them nest in this config)."""
    return re.findall(r"location\s[^{]*\{([^{}]*)\}", conf)


def test_frontend_security_headers_reach_every_page_and_asset() -> None:
    # nginx replaces the server-level add_header directives with a location's own, so one added
    # to a location would silently strip these headers (the SPA's HTML shipped without them once).
    conf = (ROOT / "frontend" / "nginx.conf").read_text()
    locations = _location_blocks(conf)
    assert locations, "expected the config to define locations"
    assert not [body for body in locations if "add_header" in body]
    for header in ("X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy"):
        assert re.search(rf'^\s*add_header {header} ".+" always;', conf, re.MULTILINE), header


def _pins(path: Path) -> dict[str, str]:
    pins: dict[str, str] = {}
    for line in path.read_text().splitlines():
        if line.strip() and not line.startswith("#"):
            name, version = line.split("==")
            pins[canonicalize_name(name)] = version
    return pins


def test_the_image_installs_exactly_the_versions_the_tests_ran_on() -> None:
    backend = ROOT / "backend"
    assert "-r requirements.txt -c constraints.txt" in (backend / "Dockerfile").read_text()
    pins = _pins(backend / "constraints.txt")
    for line in (backend / "requirements.txt").read_text().splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        requirement = Requirement(line)
        name = canonicalize_name(requirement.name)
        assert name in pins, f"{requirement.name} is not pinned in constraints.txt"
        assert requirement.specifier.contains(pins[name]), (
            f"constraints.txt pins {name}=={pins[name]}, outside {requirement.specifier}"
        )
