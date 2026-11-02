import pytest
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from ablecredit_telemetry import (
    attach_context,
    get_trace_id,
    inject_headers,
    set_span_attributes,
    span,
    sqs_context,
    sqs_message_attributes,
)
from ablecredit_telemetry.spans import sanitize_attributes


@pytest.fixture
def exporter():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    return exporter


def test_sanitize_drops_none_and_unsupported():
    assert sanitize_attributes({"a": "x", "b": 1, "c": None, "d": {"n": 1}, "e": ["a", "b"]}) == {
        "a": "x",
        "b": 1,
        "e": ["a", "b"],
    }


def test_helpers_are_noops_without_active_span():
    set_span_attributes({"a": 1})
    assert get_trace_id() is None


def test_set_attributes_and_trace_id_on_active_span(exporter):
    with span("work") as current:
        set_span_attributes({"application.id": "ABC", "skipped": None})
        trace_id = get_trace_id()
    finished = exporter.get_finished_spans()[0]
    assert dict(finished.attributes) == {"application.id": "ABC"}
    assert trace_id == trace.format_trace_id(current.get_span_context().trace_id)


def test_span_records_exception_and_reraises(exporter):
    with pytest.raises(ValueError, match="boom"), span("fail"):
        raise ValueError("boom")
    finished = exporter.get_finished_spans()[0]
    assert finished.status.status_code.name == "ERROR"
    assert finished.events[0].name == "exception"


def test_inject_and_attach_round_trip_continues_the_trace(exporter):
    with span("producer") as producer:
        headers = inject_headers({})
    assert "traceparent" in headers
    with attach_context(headers), span("consumer") as consumer:
        pass
    assert consumer.get_span_context().trace_id == producer.get_span_context().trace_id
    assert consumer.parent.span_id == producer.get_span_context().span_id


def test_sqs_round_trip(exporter):
    with span("send") as sender:
        attributes = sqs_message_attributes()
    message = {"MessageAttributes": attributes}
    with sqs_context(message), span("receive") as receiver:
        pass
    assert receiver.get_span_context().trace_id == sender.get_span_context().trace_id


def test_attach_context_without_trace_is_noop(exporter):
    with attach_context({}), span("solo") as solo:
        assert solo.parent is None
