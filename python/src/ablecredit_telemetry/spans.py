"""Small helpers over the OpenTelemetry API for everyday use in application code."""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from typing import Any

from opentelemetry import trace
from opentelemetry.trace import Span, Status, StatusCode

_SCALARS = (str, bool, int, float)


def _is_valid(value: Any) -> bool:
    if isinstance(value, _SCALARS):
        return True
    return isinstance(value, (list, tuple)) and all(isinstance(item, _SCALARS) for item in value)


def sanitize_attributes(attributes: Mapping[str, Any]) -> dict[str, Any]:
    """Drop ``None`` and anything OpenTelemetry cannot store (dicts, objects)."""
    return {key: value for key, value in attributes.items() if value is not None and _is_valid(value)}


def set_span_attributes(attributes: Mapping[str, Any]) -> None:
    """Attach attributes to the currently active span. No-op when there is none.

    Attributes belong to that one span only; child spans do not inherit them.
    """
    span = trace.get_current_span()
    if span.get_span_context().is_valid:
        span.set_attributes(sanitize_attributes(attributes))


def get_trace_id() -> str | None:
    """Trace id (32 hex chars) of the active span, for correlating logs and error reports."""
    context = trace.get_current_span().get_span_context()
    return trace.format_trace_id(context.trace_id) if context.is_valid else None


@contextmanager
def span(
    name: str, attributes: Mapping[str, Any] | None = None, *, tracer_name: str = "ablecredit_telemetry"
) -> Iterator[Span]:
    """Run a block inside a new child span; exceptions are recorded on it and re-raised."""
    with trace.get_tracer(tracer_name).start_as_current_span(
        name,
        attributes=sanitize_attributes(attributes or {}),
        record_exception=True,
        set_status_on_exception=False,
    ) as current:
        try:
            yield current
        except BaseException as error:
            current.set_status(Status(StatusCode.ERROR, str(error)))
            raise
