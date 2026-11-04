"""Turn a request body into a short, safe string for a span attribute.

A body is never recorded as it is. It is cut down and cleaned first:

- values under sensitive keys (password, token, mobile, PAN, Aadhaar, bank, KYC, ...) become ``[redacted]``;
- values that LOOK sensitive (PAN, Aadhaar, phone, email, card, IFSC, GSTIN, tokens, secret URL parameters, ...) are
  masked even under harmless keys;
- long strings, big lists, deep nesting and binary data are shortened to a size marker;
- the whole result is capped (default 4096 characters).

The rules are identical to the Node implementation in ``@ablecredit/telemetry``, so every service records bodies the
same way.
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from opentelemetry import trace

REDACTED = "[redacted]"

# Keys whose VALUE is never recorded, whatever it contains. Matched anywhere in the key, case-insensitively.
DEFAULT_REDACT_KEYS = re.compile(
    "|".join(
        [
            # credentials and secrets
            r"pass(word|wd|code|phrase)?",
            "secret",
            "token",
            "authorization",
            "bearer",
            r"api[-_]?key",
            "apikey",
            r"private[-_]?key",
            "credential",
            "cookie",
            "session",
            "jwt",
            "signature",
            "otp",
            "mpin",
            "cvv",
            "cvc",
            r"\bpin\b",
            "ssh",
            r"webhook[-_]?secret",
            # identity documents and personal identifiers
            "aadhaar",
            "aadhar",
            "uidai",
            r"pan(_?(no|number|card))?$",
            "ssn",
            "passport",
            "voter",
            "epic",
            "licen[cs]e",
            "driving",
            "kyc",
            r"gst(in)?$",
            "tan$",
            "cin$",
            # contact details
            "mobile",
            "phone",
            "msisdn",
            "whatsapp",
            "email",
            "address",
            r"pin[-_]?code",
            "postal",
            "zip",
            # people
            r"(first|middle|last|full|father|mother|spouse|applicant|borrower|customer|guarantor|nominee|contact)_?name",
            "^name$",
            "dob",
            "birth",
            "gender",
            "religion",
            "caste",
            "marital",
            "nationality",
            # banking and money
            r"account(_?(no|number|num))?$",
            "ifsc",
            "swift",
            "iban",
            "routing",
            "bank",
            "beneficiary",
            "upi",
            "vpa",
            "card",
            "salary",
            "income",
            "turnover",
            "revenue",
            "balance",
            r"credit[-_]?score",
            "cibil",
            "bureau",
            # location and biometrics
            "latitude",
            "longitude",
            r"\blat\b",
            r"\blng\b",
            r"\blon\b",
            "geo",
            "gps",
            "location",
            "photo",
            "selfie",
            "biometric",
            "fingerprint",
            "face",
            "private",
        ]
    ),
    re.IGNORECASE,
)

# Values that look like sensitive data, masked wherever they appear inside a string. Order matters: specific before
# general. A pattern with a capture group keeps that group (the URL parameter name) and masks only the rest.
# "loose" patterns match plain digit runs and long strings, which also occur inside ids (ACDE1A187394268679AE9C5), so
# they are skipped for values under id-like keys (application_id, file_ids, ...). The strict ones always apply.
_SENSITIVE_VALUE_PATTERNS: list[tuple[re.Pattern[str], bool]] = [
    (
        re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
        False,
    ),  # private key block
    (re.compile(r"\b[a-z][a-z0-9+.-]*://[^\s/@:]+:[^\s/@]+@", re.IGNORECASE), False),  # credentials inside a URL
    (
        re.compile(
            r"([?&;](?:x-amz-[\w-]+|signature|sig|token|access_token|id_token|api[-_]?key|key|secret|password|passwd|auth|code"
            r"|otp)=)[^&\s\"'#]+",
            re.IGNORECASE,
        ),
        False,
    ),  # secret URL parameters
    (re.compile(r"\bBearer\s+[\w.~+/-]+=*", re.IGNORECASE), False),  # bearer tokens
    (re.compile(r"eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}"), False),  # JWT
    (re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"), False),  # AWS access key id
    (re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b", re.IGNORECASE), False),  # PAN
    (re.compile(r"\b[A-Z]{4}0[A-Z0-9]{6}\b"), False),  # IFSC
    (re.compile(r"\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b"), False),  # GSTIN
    (re.compile(r"\b[A-Z]{3}\d{7}\b"), False),  # voter id (EPIC)
    (re.compile(r"\b[A-PR-WY][1-9]\d\s?\d{4}[1-9]\b"), False),  # passport
    (re.compile(r"\b[A-Z]{2}\d{2}[ -]?\d{11}\b"), False),  # driving licence
    (re.compile(r"(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}(?!\d)"), True),  # Aadhaar (12 digits)
    (re.compile(r"(?<!\d)(?:\+?91[- ]?|0)?[6-9]\d{9}(?!\d)"), True),  # Indian mobile number
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), False),  # email
    (re.compile(r"\b[\w.-]{2,}@[a-z]{2,15}\b", re.IGNORECASE), False),  # UPI handle (name@bank)
    (re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"), True),  # IPv4 address
    (re.compile(r"(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/_-]{40,}={0,2}(?![A-Za-z0-9+/=_-])"), True),  # long key-like strings
]

# Starts like a real card network (Visa, Mastercard, Amex, Diners, Discover, RuPay), so a timestamp or id never matches.
_CARD_PREFIX = re.compile(r"^(4|5[0-5]|2[2-7]|3[0-9]|6[0-9]|8[1-2])")
_CARD_CANDIDATE = re.compile(r"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)")

# Routes whose bodies are never recorded: credentials, tokens, one-time codes, identity checks.
DEFAULT_SKIP_URLS = re.compile(
    r"/(auth|login|logout|otp|password|passwd|token|refresh|verify|register|signup|sso|vpd)\b", re.IGNORECASE
)

# Bodies that are files or binary, not data.
_NON_DATA_CONTENT = re.compile(r"multipart|octet-stream|form-data|image/|audio/|video/|pdf", re.IGNORECASE)

_OFF_VALUES = {"false", "0", "no", "off"}


def _luhn_valid(digits: str) -> bool:
    total = 0
    for index, char in enumerate(reversed(digits)):
        number = int(char)
        if index % 2 == 1:
            number *= 2
            if number > 9:
                number -= 9
        total += number
    return total % 10 == 0


def _mask_cards(value: str) -> str:
    """Card numbers: 13-19 digits, spaced or hyphenated, starting like a card network AND passing the Luhn check.

    Must run before the other number patterns, or the Aadhaar rule would cut a card number in half.
    """

    def replace(match: re.Match[str]) -> str:
        digits = re.sub(r"\D", "", match.group(0))
        if 13 <= len(digits) <= 19 and _CARD_PREFIX.match(digits) and _luhn_valid(digits):
            return REDACTED
        return match.group(0)

    return _CARD_CANDIDATE.sub(replace, value)


# Keys that hold an identifier: id, _id, application_id, applicationId, file_ids, ...
_ID_LIKE_KEY = re.compile(r"(^|[_-])ids?$|[a-z]Ids?$")


def _apply(pattern: re.Pattern[str], text: str) -> str:
    keep_group = pattern.groups > 0  # e.g. the URL parameter name stays, only its value is masked
    return pattern.sub(lambda m: (m.group(1) if keep_group else "") + REDACTED, text)


def _mask(value: str, id_like: bool = False) -> str:
    out = _mask_cards(value)
    for pattern, loose in _SENSITIVE_VALUE_PATTERNS:
        if loose and id_like:
            continue
        out = _apply(pattern, out)
    return out


@dataclass(frozen=True)
class _Limits:
    max_string: int
    max_depth: int
    max_items: int
    redact: re.Pattern[str]


def _clean(value: Any, depth: int, seen: set[int], limits: _Limits, id_like: bool = False) -> Any:
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return f"[string {len(value)} chars]" if len(value) > limits.max_string else _mask(value, id_like)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return f"[binary {len(value)} bytes]"
    if hasattr(value, "model_dump"):  # pydantic model
        value = value.model_dump(mode="json")
    if isinstance(value, (list, tuple, set, frozenset, Mapping)):
        if id(value) in seen:
            return "[circular]"
        if depth >= limits.max_depth:
            return "[deep]"
        seen.add(id(value))
        if isinstance(value, Mapping):
            items = list(value.items())
            out: dict[str, Any] = {
                str(k): REDACTED
                if limits.redact.search(str(k))
                else _clean(v, depth + 1, seen, limits, bool(_ID_LIKE_KEY.search(str(k))))
                for k, v in items[: limits.max_items]
            }
            if len(items) > limits.max_items:
                out["[more]"] = f"+{len(items) - limits.max_items} keys"
            return out
        elements = list(value)
        cleaned = [_clean(v, depth + 1, seen, limits, id_like) for v in elements[: limits.max_items]]
        if len(elements) > limits.max_items:
            cleaned.append(f"[+{len(elements) - limits.max_items} more]")
        return cleaned
    text = str(value)
    return _mask(text) if len(text) <= limits.max_string else f"[{type(value).__name__}]"


def sanitize_body(
    body: Any,
    *,
    max_length: int = 4096,
    max_string_length: int = 200,
    max_depth: int = 6,
    max_items: int = 30,
    redact_keys: re.Pattern[str] | None = None,
) -> str | None:
    """The cleaned body as a JSON string, or ``None`` when there is nothing worth recording. Never raises."""
    try:
        if hasattr(body, "model_dump"):
            body = body.model_dump(mode="json")
        if not isinstance(body, (Mapping, list, tuple)) or len(body) == 0:
            return None
        redact = (
            re.compile(f"{DEFAULT_REDACT_KEYS.pattern}|{redact_keys.pattern}", re.IGNORECASE)
            if redact_keys
            else DEFAULT_REDACT_KEYS
        )
        limits = _Limits(max_string=max_string_length, max_depth=max_depth, max_items=max_items, redact=redact)
        text = json.dumps(_clean(body, 0, set(), limits), default=str, separators=(",", ":"))
        return f"{text[:max_length]}…[truncated]" if len(text) > max_length else text
    except Exception:
        return None


def request_body_capture_enabled(env: Mapping[str, str] | None = None) -> bool:
    """Request-body recording is on unless OTEL_CAPTURE_REQUEST_BODY is set to false / 0 / no / off."""
    source = os.environ if env is None else env
    return source.get("OTEL_CAPTURE_REQUEST_BODY", "").strip().lower() not in _OFF_VALUES


def record_request_body(
    body: Any,
    *,
    url: str | None = None,
    skip_urls: re.Pattern[str] | None = None,
    content_type: str | None = None,
    **options: Any,
) -> None:
    """Record the cleaned body on the active span as ``http.request.body``.

    Does nothing when there is no usable body, no recording span, the route is credential-like (login, otp, token, ...),
    or ``OTEL_CAPTURE_REQUEST_BODY=false``. Never raises.
    """
    try:
        if not request_body_capture_enabled():
            return
        if url and (skip_urls or DEFAULT_SKIP_URLS).search(url):
            return
        if content_type and _NON_DATA_CONTENT.search(content_type):
            return
        span = trace.get_current_span()
        if not span.is_recording():
            return
        text = sanitize_body(body, **options)
        if text:
            span.set_attribute("http.request.body", text)
    except Exception:
        return
