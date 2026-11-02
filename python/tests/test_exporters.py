import logging

from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

import ablecredit_telemetry.exporters as exporters
from ablecredit_telemetry import (
    TelemetryConfig,
    otlp_log_processor,
    otlp_metric_reader,
    otlp_span_processor,
    setup_telemetry,
)
from ablecredit_telemetry.setup import _SkipTelemetryLoggers

ENDPOINT = "http://signoz.test:4318"


def _config(**kwargs):
    return TelemetryConfig.from_env(service_name="svc", env={}, **kwargs)


class _RecordingExporter:
    """Stands in for the OTLP span exporter: remembers where it was pointed and what it was given."""

    def __init__(self, endpoint, headers=None, **_):
        self.endpoint = endpoint
        self.headers = headers or {}
        self.spans: list = []

    def export(self, spans):
        self.spans.extend(spans)
        from opentelemetry.sdk.trace.export import SpanExportResult

        return SpanExportResult.SUCCESS

    def shutdown(self):
        return None

    def force_flush(self, timeout_millis=30000):
        return True


def test_builders_return_nothing_when_export_is_off():
    off = _config()  # no endpoint
    assert otlp_span_processor(off) is None
    assert otlp_metric_reader(off) is None
    assert otlp_log_processor(off) is None


def test_builders_return_nothing_when_switched_off_even_with_an_endpoint():
    switched_off = _config(endpoint=ENDPOINT, enabled=False)
    assert otlp_span_processor(switched_off) is None
    assert otlp_metric_reader(switched_off) is None
    assert otlp_log_processor(switched_off) is None


def test_span_processor_targets_the_traces_path_with_headers(monkeypatch):
    monkeypatch.setattr(exporters, "OTLPSpanExporter", _RecordingExporter)
    processor = otlp_span_processor(_config(endpoint=ENDPOINT + "/", headers={"x-key": "k"}))
    try:
        exporter = processor._batch_processor._exporter
        assert exporter.endpoint == f"{ENDPOINT}/v1/traces"
        assert exporter.headers == {"x-key": "k"}
    finally:
        processor.shutdown()


def test_a_service_can_add_signoz_to_a_provider_it_already_owns(monkeypatch):
    """The ai-node-executor case: its own provider with an Axiom processor; SigNoz is added next to it."""
    monkeypatch.setattr(exporters, "OTLPSpanExporter", _RecordingExporter)
    axiom = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(axiom))
    signoz = otlp_span_processor(_config(endpoint=ENDPOINT))
    provider.add_span_processor(signoz)

    provider.get_tracer("t").start_span("work").end()
    provider.force_flush()

    assert [s.name for s in axiom.get_finished_spans()] == ["work"]
    assert [s.name for s in signoz._batch_processor._exporter.spans] == ["work"]
    provider.shutdown()


def test_metric_reader_can_be_given_to_a_meter_provider_that_is_created_with_it():
    reader = otlp_metric_reader(_config(endpoint=ENDPOINT), interval_seconds=60)
    provider = MeterProvider(metric_readers=[reader])
    try:
        assert provider is not None
    finally:
        provider.shutdown()


def test_setup_can_leave_traces_and_metrics_to_the_service(monkeypatch):
    """With traces/metrics off the library creates no tracer or meter provider, so the service's own are untouched."""
    created = []
    monkeypatch.setattr("ablecredit_telemetry.setup.otel_trace.set_tracer_provider", created.append)
    monkeypatch.setattr("ablecredit_telemetry.setup.otel_metrics.set_meter_provider", created.append)

    telemetry = setup_telemetry("svc", endpoint=ENDPOINT, traces=False, metrics=False, logs=True, env={})
    try:
        assert telemetry.enabled is True
        assert created == []
        assert telemetry._tracer_provider is None and telemetry._meter_provider is None
        assert telemetry._logger_provider is not None
    finally:
        telemetry.shutdown()


def test_the_log_handler_skips_the_exporters_own_loggers():
    flt = _SkipTelemetryLoggers()

    def record(name):
        return logging.LogRecord(name, logging.ERROR, __file__, 1, "msg", None, None)

    assert flt.filter(record("opentelemetry.exporter.otlp.proto.http.trace_exporter")) is False
    assert flt.filter(record("urllib3.connectionpool")) is False
    assert flt.filter(record("app.sqs_ingest")) is True
