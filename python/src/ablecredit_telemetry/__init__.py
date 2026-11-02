"""OpenTelemetry setup for AbleCredit Python services, exported to SigNoz over OTLP/HTTP."""

from .config import TelemetryConfig
from .exporters import otlp_log_processor, otlp_metric_reader, otlp_span_processor
from .instrumentation import instrument_fastapi, instrument_libraries
from .propagation import attach_context, inject_headers, sqs_context, sqs_message_attributes
from .setup import Telemetry, setup_telemetry
from .spans import get_trace_id, set_span_attributes, span

__all__ = [
    "Telemetry",
    "TelemetryConfig",
    "attach_context",
    "get_trace_id",
    "inject_headers",
    "instrument_fastapi",
    "instrument_libraries",
    "otlp_log_processor",
    "otlp_metric_reader",
    "otlp_span_processor",
    "set_span_attributes",
    "setup_telemetry",
    "span",
    "sqs_context",
    "sqs_message_attributes",
]
