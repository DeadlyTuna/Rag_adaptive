"""LLM providers — the only place the system talks to a language model.

The LLM is used for two jobs, and it is never trained or modified by this system:
  1. writing the answer from the retrieved context (streamed token by token)
  2. optionally, classifying a message into a memory class (structured JSON)

Providers:
  • AnthropicLLM     — Claude via the official `anthropic` SDK
  • OpenAICompatLLM  — anything that speaks the OpenAI chat-completions API:
                       Ollama (local, free), LM Studio, Groq, OpenAI, …
"""

from __future__ import annotations

import json
import logging
from typing import AsyncIterator, Optional, Protocol

log = logging.getLogger("adaptive-rag")


class LLM(Protocol):
    name: str  # model id, shown in the UI and stored on each answer

    def stream(self, system: str, messages: list[dict], max_tokens: int = ...) -> AsyncIterator[str]: ...

    async def complete_json(self, system: str, user: str, schema: dict, max_tokens: int = ...) -> dict: ...


# Models that accept the server-side refusal fallback (`fallbacks: "default"`). On a safety
# decline the API re-runs the request on Anthropic's recommended model inside the same call.
FALLBACK_BETA = "server-side-fallback-2026-07-01"
_FALLBACK_MODELS = ("claude-opus-5", "claude-fable-5", "claude-mythos-5", "claude-sonnet-5-5")


def describe_llm_error(e: BaseException) -> str:
    """One readable line for the log, instead of a stack trace."""
    try:
        import anthropic
    except ImportError:  # pragma: no cover
        return str(e) or type(e).__name__

    if isinstance(e, anthropic.AuthenticationError):
        return "Claude rejected the credentials — check ANTHROPIC_API_KEY (or run `ant auth login`)."
    if isinstance(e, anthropic.PermissionDeniedError):
        return "this API key can't use that model — check ANTHROPIC_MODEL and the key's workspace."
    if isinstance(e, anthropic.NotFoundError):
        return "model not found — check ANTHROPIC_MODEL."
    if isinstance(e, anthropic.RateLimitError):
        return "rate limited by the Claude API — slow down or raise the limit."
    if isinstance(e, anthropic.BadRequestError):
        return f"Claude rejected the request: {e.message}"
    if isinstance(e, anthropic.APIStatusError):
        return f"Claude API error {e.status_code}: {e.message}"
    if isinstance(e, anthropic.APITimeoutError):
        return "the Claude API timed out."
    if isinstance(e, anthropic.APIConnectionError):
        return "couldn't reach the Claude API — check the network."
    if "credentials" in str(e).lower() or "api_key" in str(e).lower():
        return "no Claude credentials found — set ANTHROPIC_API_KEY in backend/.env or run `ant auth login`."
    return str(e) or type(e).__name__


class AnthropicLLM:
    def __init__(self, api_key: Optional[str], model: str, json_model: Optional[str] = None, timeout: float = 120.0, http_client=None) -> None:
        from anthropic import AsyncAnthropic

        extra = {"http_client": http_client} if http_client is not None else {}
        # With no key the SDK resolves ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile.
        if api_key:
            extra["api_key"] = api_key
        self.client = AsyncAnthropic(timeout=timeout, max_retries=2, **extra)
        self.name = model
        self.json_model = json_model or model

    @staticmethod
    def _effort(model: str) -> dict:
        # A short cited answer needs little thinking. Opus 5.5 can't turn thinking off and
        # defaults to "medium", so "low" is set explicitly. Haiku 4.5 doesn't accept `effort`.
        return {} if "haiku" in model else {"effort": "low"}

    @staticmethod
    def _fallback(model: str) -> dict:
        if model.startswith(_FALLBACK_MODELS):
            return {"betas": [FALLBACK_BETA], "fallbacks": "default"}
        return {}

    async def stream(self, system: str, messages: list[dict], max_tokens: int = 64000) -> AsyncIterator[str]:
        # max_tokens is a ceiling that includes any thinking, not a target length.
        # The system prompt is static, so it's cached (cheaper + faster after the first turn).
        cfg = self._effort(self.name)
        fb = self._fallback(self.name)
        api = self.client.beta.messages if fb else self.client.messages
        async with api.stream(
            model=self.name,
            max_tokens=max_tokens,
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=messages,
            **({"output_config": cfg} if cfg else {}),
            **fb,
        ) as s:
            async for text in s.text_stream:
                yield text
            final = await s.get_final_message()
        if final.model != self.name:
            log.info("%s declined; the answer was finished by %s.", self.name, final.model)
        if final.stop_reason == "refusal":
            raise RuntimeError("The model declined to answer this.")

    async def complete_json(self, system: str, user: str, schema: dict, max_tokens: int = 16000) -> dict:
        # Structured outputs: the response is guaranteed to be JSON matching `schema`.
        resp = await self.client.messages.create(
            model=self.json_model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
            output_config={"format": {"type": "json_schema", "schema": schema}, **self._effort(self.json_model)},
        )
        if resp.stop_reason == "refusal":
            raise RuntimeError("The model declined to classify this.")
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        return json.loads(text)


class OpenAICompatLLM:
    def __init__(self, base_url: str, api_key: str, model: str, json_model: Optional[str] = None, timeout: float = 120.0, http_client=None) -> None:
        from openai import AsyncOpenAI

        extra = {"http_client": http_client} if http_client is not None else {}
        self.client = AsyncOpenAI(base_url=base_url, api_key=api_key or "not-needed", timeout=timeout, max_retries=1, **extra)
        self.name = model
        self.json_model = json_model or model

    async def stream(self, system: str, messages: list[dict], max_tokens: int = 1200) -> AsyncIterator[str]:
        resp = await self.client.chat.completions.create(
            model=self.name,
            messages=[{"role": "system", "content": system}, *messages],
            max_tokens=max_tokens,
            stream=True,
        )
        async for chunk in resp:
            if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    async def complete_json(self, system: str, user: str, schema: dict, max_tokens: int = 400) -> dict:
        msgs = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        try:
            resp = await self.client.chat.completions.create(
                model=self.json_model,
                messages=msgs,
                max_tokens=max_tokens,
                response_format={"type": "json_schema", "json_schema": {"name": "result", "schema": schema, "strict": True}},
            )
        except Exception as e:  # noqa: BLE001 — older servers only know json_object
            log.info("json_schema not supported (%s) — retrying with json_object", e)
            resp = await self.client.chat.completions.create(
                model=self.json_model,
                messages=[{"role": "system", "content": system + "\nReply with a single JSON object only."}, msgs[1]],
                max_tokens=max_tokens,
                response_format={"type": "json_object"},
            )
        return json.loads(resp.choices[0].message.content or "{}")


def make_llm(settings) -> Optional[LLM]:
    """Pick a provider from the environment (see .env.example)."""
    provider = settings.llm_provider
    if provider == "auto":
        provider = "anthropic" if settings.anthropic_api_key else "openai" if settings.openai_base_url else "none"
    try:
        if provider == "anthropic":
            if not settings.anthropic_api_key:
                log.info("LLM_PROVIDER=anthropic without ANTHROPIC_API_KEY — using ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile.")
            return AnthropicLLM(settings.anthropic_api_key or None, settings.anthropic_model, settings.anthropic_classifier_model or None)
        if provider == "openai":
            return OpenAICompatLLM(
                settings.openai_base_url or "https://api.openai.com/v1",
                settings.openai_api_key,
                settings.openai_model,
                settings.openai_classifier_model,
            )
    except Exception as e:  # noqa: BLE001
        log.warning("Could not set up the LLM (%s) — answers will use templates.", describe_llm_error(e))
    return None
