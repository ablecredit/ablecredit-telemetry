from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from ablecredit_telemetry import instrument_fastapi, instrument_libraries, span
from ablecredit_telemetry.propagation import inject_headers


def test_instrument_libraries_skips_missing_libraries():
    with mock.patch("importlib.util.find_spec", return_value=None):
        assert instrument_libraries() == []


def test_fastapi_continues_caller_trace_and_skips_health():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    app = FastAPI()

    @app.get("/work")
    def work() -> dict[str, str]:
        return {"ok": "yes"}

    @app.get("/mapping")
    def mapping() -> dict[str, str]:
        return {"ok": "yes"}

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"ok": "yes"}

    instrument_fastapi(app)
    with span("caller") as caller:
        headers = inject_headers({})
    client = TestClient(app)
    client.get("/health")
    client.get("/work", headers=headers)
    client.get("/mapping")

    server_spans = [s for s in exporter.get_finished_spans() if s.kind.name == "SERVER"]
    assert server_spans, "no server span recorded"
    assert any(s.context.trace_id == caller.get_span_context().trace_id for s in server_spans)
    assert not any("/health" in s.name for s in server_spans)
    assert any("/mapping" in s.name for s in server_spans), "a path merely containing 'ping' must still be traced"


def test_dependency_tags_the_server_span_with_the_application_id():
    """The pattern documented in docs/recipes.md: tag the request span from a FastAPI dependency."""
    from fastapi import Depends

    from ablecredit_telemetry import set_span_attributes

    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    def tag_application(application_id: str) -> None:
        set_span_attributes({"application.id": application_id})

    app = FastAPI()

    @app.get("/applications/{application_id}", dependencies=[Depends(tag_application)])
    def read_application(application_id: str) -> dict[str, str]:
        return {"id": application_id}

    instrument_fastapi(app)
    TestClient(app).get("/applications/EXAMPLE-APP-0001")

    server_spans = [s for s in exporter.get_finished_spans() if s.kind.name == "SERVER"]
    assert [dict(s.attributes or {}).get("application.id") for s in server_spans] == ["EXAMPLE-APP-0001"]
