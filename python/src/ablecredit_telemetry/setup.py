"""Create and register the tracer, meter and logger providers."""

from __future__ import annotations

import logging
import threading
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from opentelemetry import metrics, trace
from opentelemetry._logs import set_logger_provider
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.logging.handler import LoggingHandler
from opentelemetry.sdk._logs import LoggerProvider, LogRecordProcessor
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import MetricReader, PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import SpanProcessor, TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from .config import TelemetryConfig, signal_url

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_active: Telemetry | None = None


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
        endpoint_url = config.endpoint
        headers_dict = dict(config.headers)

        tracer_provider = TracerProvider(resource=resource)
        span_processors: list[SpanProcessor] = list(extra_span_processors)
        readers: list[MetricReader] = list(extra_metric_readers)
        log_processors: list[LogRecordProcessor] = list(extra_log_processors)
        if endpoint_url:
            span_processors.append(
                BatchSpanProcessor(OTLPSpanExporter(endpoint=signal_url(endpoint_url, "traces"), headers=headers_dict))
            )
            readers.append(
                PeriodicExportingMetricReader(
                    OTLPMetricExporter(endpoint=signal_url(endpoint_url, "metrics"), headers=headers_dict),
                    export_interval_millis=int(metrics_interval_seconds * 1000),
                )
            )
            if logs:
                log_processors.append(
                    BatchLogRecordProcessor(
                        OTLPLogExporter(endpoint=signal_url(endpoint_url, "logs"), headers=headers_dict)
                    )
                )
        for processor in span_processors:
            tracer_provider.add_span_processor(processor)
        trace.set_tracer_provider(tracer_provider)

        meter_provider = MeterProvider(resource=resource, metric_readers=readers)
        metrics.set_meter_provider(meter_provider)

        logger_provider: LoggerProvider | None = None
        log_handler: logging.Handler | None = None
        if logs and log_processors:
            logger_provider = LoggerProvider(resource=resource)
            for log_processor in log_processors:
                logger_provider.add_log_record_processor(log_processor)
            set_logger_provider(logger_provider)
            log_handler = LoggingHandler(level=log_level, logger_provider=logger_provider)
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
