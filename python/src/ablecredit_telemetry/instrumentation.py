"""Optional library instrumentation. Each helper needs its matching extra, e.g. ``ablecredit-telemetry[fastapi]``."""

from __future__ import annotations

import importlib
import importlib.util
import logging
from typing import Any

logger = logging.getLogger(__name__)

# Matched anywhere in the URL, so each regex is anchored to a whole path (a bare "ping" would hide "/mapping").
DEFAULT_EXCLUDED_URLS = r"/health(z)?(\?|$),/ready(\?|$),/ping(\?|$),/metrics(\?|$)"


def instrument_fastapi(app: Any, *, excluded_urls: str = DEFAULT_EXCLUDED_URLS) -> None:
    """Trace every request to a FastAPI app, continuing the caller's ``traceparent``.

    Call after :func:`setup_telemetry`. ``excluded_urls`` is a comma-separated list of regexes.
    """
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

    FastAPIInstrumentor.instrument_app(app, excluded_urls=excluded_urls)


def instrument_libraries() -> list[str]:
    """Turn on httpx and botocore tracing for whichever of them is installed. Returns what was enabled.

    A library is skipped when it, or its instrumentation extra, is missing.
    """
    enabled: list[str] = []
    for library, module, instrumentor in (
        ("httpx", "opentelemetry.instrumentation.httpx", "HTTPXClientInstrumentor"),
        ("botocore", "opentelemetry.instrumentation.botocore", "BotocoreInstrumentor"),
    ):
        if importlib.util.find_spec(library) is None:
            logger.debug("%s is not installed; skipping its instrumentation", library)
            continue
        try:
            getattr(importlib.import_module(module), instrumentor)().instrument()
        except ImportError:
            logger.debug("instrumentation extra for %s is not installed; skipping", library)
            continue
        enabled.append(library)
    return enabled
