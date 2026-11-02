import logging

import pytest
from opentelemetry import _logs as otel_logs
from opentelemetry import context, metrics, trace
from opentelemetry.util._once import Once

import ablecredit_telemetry.setup as setup_module


def _reset_global_providers() -> None:
    """OpenTelemetry only allows setting each global provider once; tests need a clean slate."""
    trace._TRACER_PROVIDER_SET_ONCE = Once()
    trace._TRACER_PROVIDER = None
    metrics._internal._METER_PROVIDER_SET_ONCE = Once()
    metrics._internal._METER_PROVIDER = None
    otel_logs._internal._LOGGER_PROVIDER_SET_ONCE = Once()
    otel_logs._internal._LOGGER_PROVIDER = None


@pytest.fixture(autouse=True)
def clean_telemetry():
    setup_module._active = None
    _reset_global_providers()
    root_handlers = list(logging.getLogger().handlers)
    yield
    if setup_module._active is not None:
        setup_module._active.shutdown()
    logging.getLogger().handlers = root_handlers
    _reset_global_providers()
    context.attach(context.Context())
