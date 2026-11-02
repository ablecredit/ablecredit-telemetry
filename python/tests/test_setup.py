import logging
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import ClassVar

import pytest
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from ablecredit_telemetry import setup_telemetry, span


class _Receiver(BaseHTTPRequestHandler):
    received: ClassVar[list[tuple[str, dict[str, str], bytes]]] = []

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("content-length", 0)))
        self.received.append((self.path, dict(self.headers), body))
        self.send_response(200)
        self.send_header("content-type", "application/x-protobuf")
        self.end_headers()

    def log_message(self, *args):  # silence test output
        pass


@pytest.fixture
def receiver():
    _Receiver.received = []
    server = HTTPServer(("127.0.0.1", 0), _Receiver)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}", _Receiver.received
    server.shutdown()
    thread.join()


def test_noop_when_nothing_configured():
    telemetry = setup_telemetry("svc", env={})
    assert telemetry.enabled is False
    telemetry.shutdown()


def test_noop_when_switched_off():
    telemetry = setup_telemetry("svc", endpoint="http://h", enabled=False, env={})
    assert telemetry.enabled is False


def test_exports_spans_with_headers_to_the_endpoint(receiver):
    url, received = receiver
    telemetry = setup_telemetry(
        "e2e-service", endpoint=url, headers={"x-api-key": "secret"}, environment="test", logs=False, env={}
    )
    assert telemetry.enabled is True
    assert setup_telemetry("again", endpoint=url, env={}) is telemetry

    with span("unit-of-work", {"application.id": "EXAMPLE-APP-0001"}):
        pass
    telemetry.shutdown()
    telemetry.shutdown()

    traces = [item for item in received if item[0] == "/v1/traces"]
    assert traces, "no trace export reached the endpoint"
    _path, headers, body = traces[0]
    assert headers.get("x-api-key") == "secret"
    assert b"e2e-service" in body
    assert b"unit-of-work" in body
    assert b"EXAMPLE-APP-0001" in body


def test_extra_span_processor_gets_spans_alongside_the_endpoint(receiver):
    url, received = receiver
    extra = InMemorySpanExporter()
    telemetry = setup_telemetry(
        "dual", endpoint=url, logs=False, extra_span_processors=[SimpleSpanProcessor(extra)], env={}
    )
    with span("both"):
        pass
    telemetry.shutdown()
    assert [s.name for s in extra.get_finished_spans()] == ["both"]
    assert any(path == "/v1/traces" for path, _, _ in received)


def test_extras_without_endpoint_still_collect():
    extra = InMemorySpanExporter()
    telemetry = setup_telemetry("only-extra", extra_span_processors=[SimpleSpanProcessor(extra)], env={})
    assert telemetry.enabled is True
    with span("local"):
        pass
    assert [s.name for s in extra.get_finished_spans()] == ["local"]
    telemetry.shutdown()


def test_logs_handler_attached_and_removed(receiver):
    url, _ = receiver
    before = list(logging.getLogger().handlers)
    telemetry = setup_telemetry("logsvc", endpoint=url, env={})
    assert len(logging.getLogger().handlers) == len(before) + 1
    telemetry.shutdown()
    assert logging.getLogger().handlers == before
