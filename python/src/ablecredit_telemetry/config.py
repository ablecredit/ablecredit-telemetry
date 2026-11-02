"""Configuration: explicit arguments win over environment variables, which win over defaults."""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from urllib.parse import unquote

DEFAULT_SERVICE_NAME = "unknown-service"

_FALSE = {"false", "0", "no", "off"}
_TRUE = {"true", "1", "yes", "on"}


def parse_key_value_list(raw: str | None) -> dict[str, str]:
    """Parse ``key1=value1,key2=value2`` (OTEL_EXPORTER_OTLP_HEADERS / OTEL_RESOURCE_ATTRIBUTES format)."""
    out: dict[str, str] = {}
    if not raw:
        return out
    for pair in raw.split(","):
        key, sep, value = pair.partition("=")
        key = key.strip()
        if sep and key:
            out[key] = unquote(value.strip())
    return out


def normalize_endpoint(endpoint: str | None) -> str | None:
    """Strip trailing slashes and any signal path pasted by mistake (``/v1/traces``)."""
    if endpoint is None or not endpoint.strip():
        return None
    return re.sub(r"/v1/(traces|metrics|logs)$", "", endpoint.strip().rstrip("/"))


def signal_url(endpoint: str, signal: str) -> str:
    """Full OTLP/HTTP URL for one signal: ``traces``, ``metrics`` or ``logs``."""
    return f"{endpoint}/v1/{signal}"


def _flag(raw: str | None) -> bool | None:
    value = (raw or "").strip().lower()
    if value in _TRUE:
        return True
    if value in _FALSE:
        return False
    return None


@dataclass(frozen=True)
class TelemetryConfig:
    """Resolved settings. Build one with :meth:`from_env`."""

    service_name: str = DEFAULT_SERVICE_NAME
    service_version: str | None = None
    environment: str | None = None
    endpoint: str | None = None
    headers: Mapping[str, str] = field(default_factory=dict)
    resource_attributes: Mapping[str, str] = field(default_factory=dict)
    switched_off: bool = False

    @property
    def enabled(self) -> bool:
        """True when an OTLP endpoint is configured and nothing has switched telemetry off."""
        return bool(self.endpoint) and not self.switched_off

    @classmethod
    def from_env(
        cls,
        *,
        service_name: str | None = None,
        service_version: str | None = None,
        environment: str | None = None,
        endpoint: str | None = None,
        headers: Mapping[str, str] | None = None,
        resource_attributes: Mapping[str, str] | None = None,
        enabled: bool | None = None,
        env: Mapping[str, str] | None = None,
    ) -> TelemetryConfig:
        """Merge explicit arguments over ``env`` (default: ``os.environ``)."""
        env = os.environ if env is None else env
        env_resource = parse_key_value_list(env.get("OTEL_RESOURCE_ATTRIBUTES"))
        switched_off = (
            enabled is False or _flag(env.get("OTEL_SDK_DISABLED")) is True or _flag(env.get("OTEL_ENABLED")) is False
        )
        return cls(
            service_name=service_name or env.get("OTEL_SERVICE_NAME") or DEFAULT_SERVICE_NAME,
            service_version=service_version or env.get("OTEL_SERVICE_VERSION"),
            environment=environment or env.get("DEPLOYMENT_ENVIRONMENT") or env_resource.get("deployment.environment"),
            endpoint=normalize_endpoint(endpoint or env.get("OTEL_EXPORTER_OTLP_ENDPOINT")),
            headers={**parse_key_value_list(env.get("OTEL_EXPORTER_OTLP_HEADERS")), **(headers or {})},
            resource_attributes={**env_resource, **(resource_attributes or {})},
            switched_off=switched_off,
        )

    def resource_attributes_dict(self) -> dict[str, str]:
        """Attributes for the OpenTelemetry Resource (service.*, deployment.*)."""
        attributes = {**self.resource_attributes, "service.name": self.service_name}
        if self.service_version:
            attributes["service.version"] = self.service_version
        if self.environment:
            # Current OpenTelemetry name, plus the older one that SigNoz's "Deployment Environment" filter still reads.
            attributes["deployment.environment.name"] = self.environment
            attributes["deployment.environment"] = self.environment
        return attributes
