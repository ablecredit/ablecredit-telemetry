"""Carry a trace across process boundaries: HTTP headers and SQS message attributes (W3C ``traceparent``)."""

from __future__ import annotations

from collections.abc import Iterator, Mapping, MutableMapping
from contextlib import AbstractContextManager, contextmanager
from typing import Any

from opentelemetry import context, propagate

TRACE_KEYS = ("traceparent", "tracestate")


def inject_headers(headers: MutableMapping[str, str] | None = None) -> MutableMapping[str, str]:
    """Add the current trace context to outgoing HTTP headers (returns the same mapping)."""
    carrier: MutableMapping[str, str] = {} if headers is None else headers
    propagate.inject(carrier)
    return carrier


@contextmanager
def attach_context(carrier: Mapping[str, str]) -> Iterator[None]:
    """Run a block inside the trace described by ``carrier`` (no-op if it holds no trace context)."""
    wanted = {key: carrier[key] for key in TRACE_KEYS if key in carrier}
    token = context.attach(propagate.extract(wanted)) if wanted else None
    try:
        yield
    finally:
        if token is not None:
            context.detach(token)


def sqs_message_attributes() -> dict[str, dict[str, str]]:
    """Message attributes for ``sqs.send_message(MessageAttributes=...)`` that carry the current trace."""
    return {key: {"DataType": "String", "StringValue": value} for key, value in inject_headers({}).items()}


def sqs_context(message: Mapping[str, Any]) -> AbstractContextManager[None]:
    """Run a block inside the trace of whoever enqueued this SQS message (boto3 ``receive_message`` item)."""
    attributes = message.get("MessageAttributes") or {}
    carrier = {key: attributes[key]["StringValue"] for key in TRACE_KEYS if key in attributes}
    return attach_context(carrier)
