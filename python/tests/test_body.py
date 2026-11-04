import json

import pytest
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from ablecredit_telemetry import record_request_body, request_body_capture_enabled, sanitize_body


def parse(body, **options):
    return json.loads(sanitize_body(body, **options))


def test_keeps_ordinary_values_and_redacts_sensitive_keys():
    out = parse(
        {
            "application_id": "APP-1",
            "status": "open",
            "password": "hunter2",
            "access_token": "abc",
            "Authorization": "Bearer xyz",
            "mobile": "9876543210",
            "customer_email": "a@b.com",
            "pan_number": "ABCDE1234F",
            "aadhaar": "1234 5678 9012",
            "salary": 90000,
            "applicant_name": "Asha",
        }
    )

    assert out["application_id"] == "APP-1"
    assert out["status"] == "open"
    for key in (
        "password",
        "access_token",
        "Authorization",
        "mobile",
        "customer_email",
        "pan_number",
        "aadhaar",
        "salary",
        "applicant_name",
    ):
        assert out[key] == "[redacted]", key


def test_technical_names_are_not_redacted_but_a_plain_name_is():
    out = parse({"template_name": "income", "node_name": "extract", "name": "Asha"})

    assert out == {"template_name": "income", "node_name": "extract", "name": "[redacted]"}


def test_redacts_nested_keys_and_lists_of_objects():
    out = parse(
        {"borrower": {"details": {"phone": "9876543210", "city": "Pune"}}, "files": [{"id": "f1", "token": "t"}]}
    )

    assert out["borrower"]["details"] == {"phone": "[redacted]", "city": "Pune"}
    assert out["files"] == [{"id": "f1", "token": "[redacted]"}]


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("verified ABCDE1234F ok", "verified [redacted] ok"),
        ("id 1234 5678 9012.", "id [redacted]."),
        ("call 9876543210 now", "call [redacted] now"),
        ("call +91 9876543210", "call [redacted]"),
        ("mail a.b+c@example.co.in please", "mail [redacted] please"),
        ("tok eyJhbGciOiJI.eyJzdWIiOiIx.abcdefghijk end", "tok [redacted] end"),
        ("APP-1234 step 3 of 12", "APP-1234 step 3 of 12"),
    ],
)
def test_masks_sensitive_looking_values_under_harmless_keys(text, expected):
    assert parse({"remark": text})["remark"] == expected


@pytest.mark.parametrize(
    "key",
    [
        "bank_name",
        "beneficiary",
        "ifsc_code",
        "upi_id",
        "vpa",
        "account_number",
        "iban",
        "swift_code",
        "passport_no",
        "voter_id",
        "driving_licence",
        "kyc_status",
        "gstin",
        "gender",
        "religion",
        "caste",
        "marital_status",
        "nationality",
        "pincode",
        "postal_code",
        "latitude",
        "longitude",
        "gps",
        "location",
        "photo",
        "selfie",
        "fingerprint",
        "biometric",
        "cibil_score",
        "credit_score",
        "bureau_report",
        "turnover",
        "balance",
        "otp",
        "mpin",
        "cvv",
        "client_secret",
        "private_key",
        "refresh_token",
        "session_id",
        "father_name",
        "guarantor_name",
        "dob",
        "whatsapp",
    ],
)
def test_more_sensitive_keys_are_redacted(key):
    assert parse({key: "some value"})[key] == "[redacted]"


def test_id_and_technical_keys_that_only_look_similar_are_kept():
    body = {
        "account_id": "A1",
        "application_id": "APP-1",
        "org_id": "O1",
        "reference_id": "R1",
        "template_id": "T1",
        "status": "ok",
    }

    assert parse(body) == body


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("branch HDFC0001234 here", "branch [redacted] here"),
        ("gst 27ABCDE1234F1Z5 filed", "gst [redacted] filed"),
        ("epic ABC1234567 ok", "epic [redacted] ok"),
        ("pp K1234567 valid", "pp [redacted] valid"),
        ("pay asha@okaxis today", "pay [redacted] today"),
        ("from 203.0.113.42 at noon", "from [redacted] at noon"),
        ("header Bearer abc.def-123_xyz== end", "header [redacted] end"),
        ("key AKIAIOSFODNN7EXAMPLE end", "key [redacted] end"),
        ("https://user:p4ss@host.example/path", "[redacted]host.example/path"),
        (
            "https://b.s3.amazonaws.com/f.pdf?X-Amz-Signature=abcdef123&x=1",
            "https://b.s3.amazonaws.com/f.pdf?X-Amz-Signature=[redacted]&x=1",
        ),
        ("https://h/cb?code=123456&state=ok", "https://h/cb?code=[redacted]&state=ok"),
        ("card 4111 1111 1111 1111 ok", "card [redacted] ok"),
        ("card 5555-5555-5555-4444", "card [redacted]"),
        ("k -----BEGIN RSA PRIVATE KEY-----\nMIIEabc\n-----END RSA PRIVATE KEY----- end", "k [redacted] end"),
        (f"h {'a1b2c3d4' * 6} end", "h [redacted] end"),
    ],
)
def test_masks_more_sensitive_looking_values(text, expected):
    assert parse({"remark": text})["remark"] == expected


def test_keeps_real_ids_intact_even_when_they_contain_a_long_digit_run():
    body = {
        "application_id": "ACDE1A187394268679AE9C5",
        "applicationId": "ACDE1A187394268679AE9C5",
        "file_ids": ["ACDE1A187394268679AE9C5", "f2"],
        "_id": "507f1f77bcf86cd799439011",
        "workflow_id": "WF01542FEAA77334E56A60E4D09346275AF",
    }

    assert parse(body) == body


def test_still_masks_the_same_digit_run_in_free_text_and_strict_patterns_under_id_keys():
    out = parse({"remark": "ref ACDE1A187394268679AE9C5 call 9876543210", "pan_id": "ABCDE1234F", "user_id": "a@b.com"})

    assert out["remark"] == "ref ACDE1A[redacted]AE9C5 call [redacted]"
    assert out["pan_id"] == "[redacted]"
    assert out["user_id"] == "[redacted]"


def test_does_not_mask_timestamps_ids_short_codes_or_versions():
    note = (
        "ts 1793647686749 id 507f1f77bcf86cd799439011 v1.2.3 order 12345 ref APP-2026-0001 "
        "trace 4bf92f3577b34da6a3ce929d0e0e4736 n 1234567890123 end"
    )
    out = parse({"created_at": 1793647686749, "note": note})

    assert out["created_at"] == 1793647686749
    assert out["note"] == note


def test_long_strings_become_their_length_and_big_lists_are_cut():
    assert parse({"doc": "x" * 5000})["doc"] == "[string 5000 chars]"
    assert parse({"ids": list(range(100))}, max_items=3)["ids"] == [0, 1, 2, "[+97 more]"]


def test_depth_binary_and_circular_references():
    assert parse({"a": {"b": {"c": {"d": 1}}}}, max_depth=3) == {"a": {"b": {"c": "[deep]"}}}
    assert parse({"file": b"0123456789"})["file"] == "[binary 10 bytes]"
    loop: dict = {"id": "c"}
    loop["self"] = loop
    assert parse(loop) == {"id": "c", "self": "[circular]"}


def test_whole_result_is_capped_and_marked():
    text = sanitize_body({f"key{i}": "v" * 150 for i in range(30)}, max_length=200)

    assert text.endswith("…[truncated]")
    assert len(text) <= 200 + len("…[truncated]")


@pytest.mark.parametrize("body", [None, "", "plain text", 42, {}, [], b"x"])
def test_nothing_worth_recording_returns_none(body):
    assert sanitize_body(body) is None


def test_accepts_pydantic_models():
    from pydantic import BaseModel

    class Run(BaseModel):
        application_id: str
        password: str

    assert parse(Run(application_id="A1", password="p")) == {"application_id": "A1", "password": "[redacted]"}


@pytest.fixture
def exporter():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    return exporter


def _recorded(exporter):
    return exporter.get_finished_spans()[0].attributes.get("http.request.body")


def test_record_puts_the_cleaned_body_on_the_active_span(exporter):
    with trace.get_tracer("t").start_as_current_span("request"):
        record_request_body({"application_id": "A1", "password": "p"})

    assert json.loads(_recorded(exporter)) == {"application_id": "A1", "password": "[redacted]"}


@pytest.mark.parametrize("url", ["/api/v1/auth/login", "/verify-otp", "/user/password/reset", "/api/vpd/token"])
def test_never_records_credential_like_routes(exporter, url):
    with trace.get_tracer("t").start_as_current_span("request"):
        record_request_body({"username": "u", "secret": "s"}, url=url)

    assert _recorded(exporter) is None


@pytest.mark.parametrize(
    "content_type",
    ["multipart/form-data; boundary=x", "application/octet-stream", "image/png", "audio/mpeg", "application/pdf"],
)
def test_never_records_file_or_binary_bodies(exporter, content_type):
    with trace.get_tracer("t").start_as_current_span("request"):
        record_request_body({"a": 1}, content_type=content_type)

    assert _recorded(exporter) is None


def test_records_a_json_body(exporter):
    with trace.get_tracer("t").start_as_current_span("request"):
        record_request_body({"a": 1}, content_type="application/json; charset=utf-8")

    assert _recorded(exporter) == '{"a":1}'


def test_does_nothing_without_a_span_and_can_be_switched_off(exporter, monkeypatch):
    record_request_body({"a": 1})  # no active span: must not raise

    assert request_body_capture_enabled({}) is True
    for off in ("false", "0", "no", "off", "FALSE"):
        assert request_body_capture_enabled({"OTEL_CAPTURE_REQUEST_BODY": off}) is False
    monkeypatch.setenv("OTEL_CAPTURE_REQUEST_BODY", "false")
    with trace.get_tracer("t").start_as_current_span("request"):
        record_request_body({"a": 1})
    assert _recorded(exporter) is None
