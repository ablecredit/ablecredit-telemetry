"""Ready-made SigNoz exporters, for services that already create their own OpenTelemetry providers.

Most services call :func:`ablecredit_telemetry.setup_telemetry` and let the library own the providers. A service that
already builds its own (for example one that exports to Axiom) can keep doing so and just add these to its providers:
nothing it already has is replaced or changed.

Each function returns ``None`` when SigNoz export is off (no endpoint, or switched off with ``OTEL_ENABLED=false`` /
``OTEL_SDK_DISABLED=true``), so the call site is simply "add it if there is one".
"""

from __future__ import annotations

from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from .config import TelemetryConfig, signal_url


def _ready(config: TelemetryConfig) -> str | None:
    """The endpoint to send to, or None when export is off."""
    return config.endpoint if config.enabled else None


def otlp_span_processor(config: TelemetryConfig) -> BatchSpanProcessor | None:
    """A span processor that sends traces to SigNoz. Add it with ``tracer_provider.add_span_processor(...)``.

    It has its own queue and worker thread, so a slow or unreachable SigNoz cannot delay or drop what other processors
    (such as an Axiom one) on the same provider receive.
    """
    endpoint = _ready(config)
    if endpoint is None:
        return None
    return BatchSpanProcessor(OTLPSpanExporter(endpoint=signal_url(endpoint, "traces"), headers=dict(config.headers)))


def otlp_metric_reader(config: TelemetryConfig, interval_seconds: float = 30.0) -> PeriodicExportingMetricReader | None:
    """A metric reader that sends metrics to SigNoz. Pass it in ``MeterProvider(metric_readers=[...])``.

    Metric readers must be given when the ``MeterProvider`` is created; they cannot be added afterwards.
    """
    endpoint = _ready(config)
    if endpoint is None:
        return None
    return PeriodicExportingMetricReader(
        OTLPMetricExporter(endpoint=signal_url(endpoint, "metrics"), headers=dict(config.headers)),
        export_interval_millis=int(interval_seconds * 1000),
    )


def otlp_log_processor(config: TelemetryConfig) -> BatchLogRecordProcessor | None:
    """A log processor that sends logs to SigNoz. Add it with ``logger_provider.add_log_record_processor(...)``."""
    endpoint = _ready(config)
    if endpoint is None:
        return None
    return BatchLogRecordProcessor(OTLPLogExporter(endpoint=signal_url(endpoint, "logs"), headers=dict(config.headers)))
