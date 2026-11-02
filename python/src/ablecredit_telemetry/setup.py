"""Create and register the tracer, meter and logger providers."""

from __future__ import annotations

import logging
import threading
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from opentelemetry import metrics as otel_metrics
from opentelemetry import trace as otel_trace
from opentelemetry._logs import set_logger_provider
from opentelemetry.instrumentation.logging.handler import LoggingHandler
from opentelemetry.sdk._logs import LoggerProvider, LogRecordProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import MetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import SpanProcessor, TracerProvider

from .config import TelemetryConfig
from .exporters import otlp_log_processor, otlp_metric_reader, otlp_span_processor

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_active: Telemetry | None = None

# The exporter's own log lines must not be exported again, or a failing export would produce logs that fail to export...
_SKIP_LOGGER_PREFIXES = ("opentelemetry", "urllib3")


class _SkipTelemetryLoggers(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return not record.name.startswith(_SKIP_LOGGER_PREFIXES)


@dataclass
class Telemetry:
    """Handle returned by :func:`setup_telemetry`."""

    config: TelemetryConfig
    enabled: bool
    _tracer_provider: TracerProvider | None = None
    _meter_provider: MeterProvider | None = None
    _logger_provider: LoggerProvider | None = None
    _log_handler: logging.Handler | None = field(default=None, repr=False)
    _shut_down: bool = False

    def shutdown(self) -> None:
        """Flush buffered telemetry and release resources. Safe to call more than once."""
        global _active
        with _lock:
            if self._shut_down:
                return
            self._shut_down = True
            if _active is self:
                _active = None
        if self._log_handler is not None:
            logging.getLogger().removeHandler(self._log_handler)
        for provider in (self._tracer_provider, self._meter_provider, self._logger_provider):
            if provider is not None:
                provider.shutdown()


_NOOP_CONFIG = TelemetryConfig()


def setup_telemetry(
    service_name: str | None = None,
    *,
    service_version: str | None = None,
    environment: str | None = None,
    endpoint: str | None = None,
    headers: Mapping[str, str] | None = None,
    resource_attributes: Mapping[str, str] | None = None,
    enabled: bool | None = None,
    traces: bool = True,
    metrics: bool = True,
    logs: bool = True,
    log_level: int = logging.INFO,
    metrics_interval_seconds: float = 30.0,
    extra_span_processors: Sequence[SpanProcessor] = (),
    extra_metric_readers: Sequence[MetricReader] = (),
    extra_log_processors: Sequence[LogRecordProcessor] = (),
    env: Mapping[str, str] | None = None,
) -> Telemetry:
    """Start tracing, metrics and logs for a Python service. Call once, early, before serving requests.

    Telemetry goes to SigNoz when ``OTEL_EXPORTER_OTLP_ENDPOINT`` (or ``endpoint``) is set. It is a no-op
    when nothing is configured, or when switched off with ``enabled=False``, ``OTEL_ENABLED=false`` or
    ``OTEL_SDK_DISABLED=true``.

    The ``extra_*`` arguments add destinations next to SigNoz without replacing it, e.g. an Axiom span
    processor during a migration. With extras but no endpoint, telemetry goes only to the extras.

    ``traces``, ``metrics`` and ``logs`` choose which signals the library sets up. Turn one off when your service
    already creates that provider itself (for example for Axiom), and add SigNoz to it with the functions in
    :mod:`ablecredit_telemetry.exporters` instead.

    Calling it again returns the original handle instead of registering a second set of providers.
    """
    global _active
    config = TelemetryConfig.from_env(
        service_name=service_name,
        service_version=service_version,
        environment=environment,
        endpoint=endpoint,
        headers=headers,
        resource_attributes=resource_attributes,
        enabled=enabled,
        env=env,
    )
    has_extras = bool(extra_span_processors or extra_metric_readers or extra_log_processors)

    with _lock:
        if _active is not None:
            return _active
        if config.switched_off or not (config.endpoint or has_extras):
            return Telemetry(config=config, enabled=False)

        resource = Resource.create(config.resource_attributes_dict())

        tracer_provider: TracerProvider | None = None
        if traces:
            tracer_provider = TracerProvider(resource=resource)
            span_processors: list[SpanProcessor] = list(extra_span_processors)
            if (signoz_spans := otlp_span_processor(config)) is not None:
                span_processors.append(signoz_spans)
            for processor in span_processors:
                tracer_provider.add_span_processor(processor)
            otel_trace.set_tracer_provider(tracer_provider)

        meter_provider: MeterProvider | None = None
        if metrics:
            readers: list[MetricReader] = list(extra_metric_readers)
            if (signoz_metrics := otlp_metric_reader(config, metrics_interval_seconds)) is not None:
                readers.append(signoz_metrics)
            meter_provider = MeterProvider(resource=resource, metric_readers=readers)
            otel_metrics.set_meter_provider(meter_provider)

        log_processors: list[LogRecordProcessor] = list(extra_log_processors)
        if (signoz_logs := otlp_log_processor(config)) is not None:
            log_processors.append(signoz_logs)
        logger_provider: LoggerProvider | None = None
        log_handler: logging.Handler | None = None
        if logs and log_processors:
            logger_provider = LoggerProvider(resource=resource)
            for log_processor in log_processors:
                logger_provider.add_log_record_processor(log_processor)
            set_logger_provider(logger_provider)
            log_handler = LoggingHandler(level=log_level, logger_provider=logger_provider)
            log_handler.addFilter(_SkipTelemetryLoggers())
            logging.getLogger().addHandler(log_handler)

        _active = Telemetry(
            config=config,
            enabled=True,
            _tracer_provider=tracer_provider,
            _meter_provider=meter_provider,
            _logger_provider=logger_provider,
            _log_handler=log_handler,
        )
        logger.info("Telemetry enabled for %s", config.service_name)
        return _active
