import pytest

from ablecredit_telemetry.config import TelemetryConfig, normalize_endpoint, parse_key_value_list, signal_url


def test_parse_key_value_list_trims_decodes_and_skips_malformed():
    assert parse_key_value_list("a=1, b = two ,c=hello%20world") == {"a": "1", "b": "two", "c": "hello world"}
    assert parse_key_value_list("token=abc=def,broken,=nokey") == {"token": "abc=def"}
    assert parse_key_value_list(None) == {}


def test_normalize_endpoint_strips_slash_and_signal_path():
    assert normalize_endpoint("http://h:4318/") == "http://h:4318"
    assert normalize_endpoint("http://h:4318/v1/traces") == "http://h:4318"
    assert normalize_endpoint("  ") is None
    assert signal_url("http://h:4318", "logs") == "http://h:4318/v1/logs"


def test_disabled_without_endpoint():
    assert TelemetryConfig.from_env(service_name="s", env={}).enabled is False


def test_enabled_from_environment():
    config = TelemetryConfig.from_env(env={"OTEL_EXPORTER_OTLP_ENDPOINT": "http://h:4318", "OTEL_SERVICE_NAME": "api"})
    assert config.enabled is True
    assert (config.endpoint, config.service_name) == ("http://h:4318", "api")


def test_explicit_arguments_win_over_environment():
    config = TelemetryConfig.from_env(
        service_name="opt",
        endpoint="http://opt",
        env={"OTEL_EXPORTER_OTLP_ENDPOINT": "http://env", "OTEL_SERVICE_NAME": "env"},
    )
    assert (config.endpoint, config.service_name) == ("http://opt", "opt")


@pytest.mark.parametrize(
    ("kwargs", "extra_env"),
    [({"enabled": False}, {}), ({}, {"OTEL_ENABLED": "false"}), ({}, {"OTEL_SDK_DISABLED": "true"})],
)
def test_can_be_switched_off(kwargs, extra_env):
    config = TelemetryConfig.from_env(env={"OTEL_EXPORTER_OTLP_ENDPOINT": "http://h", **extra_env}, **kwargs)
    assert config.enabled is False


def test_headers_merge_with_explicit_winning():
    config = TelemetryConfig.from_env(
        headers={"a": "opt"},
        env={"OTEL_EXPORTER_OTLP_HEADERS": "a=env,b=env", "OTEL_EXPORTER_OTLP_ENDPOINT": "http://h"},
    )
    assert dict(config.headers) == {"a": "opt", "b": "env"}


def test_resource_attributes():
    config = TelemetryConfig.from_env(
        service_name="api", service_version="1.2.3", environment="staging", resource_attributes={"team": "core"}, env={}
    )
    assert config.resource_attributes_dict() == {
        "team": "core",
        "service.name": "api",
        "service.version": "1.2.3",
        "deployment.environment.name": "staging",
    }
