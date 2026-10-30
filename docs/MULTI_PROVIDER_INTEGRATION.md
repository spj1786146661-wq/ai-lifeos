# AI-LifeOS Multi-Provider Integration

Date: 2026-10-30

## Scope

This stage connects the existing 17-provider registry to the existing
request-scoped BYOK flow. It does not change LifeRecord storage, browser
attachments, Firebase, database migration state, or the private local ChatGPT
plan implementation.

The common path is:

1. The browser selects a provider and model.
2. The browser sends the user's API key only in the current request body.
3. `validateByokConnection()` rejects client-supplied Base URLs and resolves the
   fixed server-side endpoint.
4. `runProviderText()` calls the selected provider once.
5. Life-record JSON is parsed and validated with the existing LifeRecord
   Schema.
6. The selected provider identity is retained in `sourceRef` and UI labels.
7. A provider failure is reported or labelled as rule fallback. It never
   silently switches to TokenHub or another paid provider.

## First-Wave Providers

| Provider | Protocol | Fixed endpoint | Default model | Structured output | Text chat | Smart follow-up | Data analysis | Real API verified in this stage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Tencent TokenHub | OpenAI-compatible Chat Completions | `https://tokenhub.tencentmaas.com/v1/chat/completions` | `deepseek/deepseek-flash` | JSON mode plus explicit thinking disabled | Implemented and previously validated by the user | Implemented | Implemented | Retained from prior real test |
| Zhipu BigModel | OpenAI-compatible Chat Completions | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | `glm-5.3` | `response_format: json_object` | Implemented and mock tested | Implemented and mock tested | Implemented and mock tested | Not run in this stage |
| DeepSeek official | OpenAI-compatible Chat Completions | `https://api.deepseek.com/chat/completions` | `deepseek-chat` | `response_format: json_object` | Implemented and mock tested | Implemented and mock tested | Implemented and mock tested | Not run in this stage |
| Alibaba Cloud Bailian Qwen | OpenAI-compatible Chat Completions | `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` | `qwen-plus` | `response_format: json_object` | Implemented and mock tested | Implemented and mock tested | Implemented and mock tested | Not run in this stage |
| OpenRouter | OpenAI-compatible Chat Completions | `https://openrouter.ai/api/v1/chat/completions` | `openrouter/auto` | `response_format: json_object` | Implemented and mock tested | Implemented and mock tested | Implemented and mock tested | Not run in this stage |
| OpenAI API | OpenAI-compatible Chat Completions | `https://api.openai.com/v1/chat/completions` | `gpt-4.1-mini` | `response_format: json_object` | Implemented and mock tested | Implemented and mock tested | Implemented and mock tested | Not run in this stage |
| Google Gemini | Gemini GenerateContent | `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` | `gemini-2.5-flash` | `responseMimeType: application/json` | Implemented and mock tested | Implemented and mock tested | Implemented and mock tested | Not run in this stage |

Official references checked:

- TokenHub: <https://cloud.tencent.com/document/product/1850>
- Zhipu BigModel chat completion:
  <https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%AF%B9%E8%AF%9D%E8%A1%A5%E5%85%A8>
- DeepSeek chat completion:
  <https://api-docs.deepseek.com/api/create-chat-completion>
- Alibaba Cloud Model Studio OpenAI compatibility:
  <https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions/>
- OpenRouter chat completion:
  <https://openrouter.ai/docs/api-reference/chat-completion>
- OpenAI Chat Completions:
  <https://platform.openai.com/docs/api-reference/chat/create>
- Gemini GenerateContent:
  <https://ai.google.dev/api/generate-content>
- Anthropic Messages:
  <https://docs.anthropic.com/en/api/messages>

## Output-Token Fields

OpenAI and Qwen now use `max_completion_tokens`; their current official
documentation recommends that field. TokenHub, BigModel, DeepSeek, OpenRouter,
and the remaining OpenAI-compatible entries use `max_tokens`, with the
per-request cap still clamped to 128–2,000 tokens. TokenHub retains its
previously validated dedicated request body.

## Other Registered Providers

The following providers use the same generic OpenAI-compatible adapter and
fixed endpoint boundary:

- SiliconFlow
- Volcano Ark
- Moonshot Kimi
- MiniMax
- Tencent Hunyuan
- xAI
- Mistral
- Groq
- Together AI

They have endpoint, authentication, one-call, error-mapping, and response-shape
mock coverage through the unified adapter. This is adapter coverage, not proof
that every listed model is currently enabled for every account. In particular,
Volcano Ark commonly requires an account-specific endpoint/model identifier;
the UI therefore permits a reviewed manual model ID.

Providers whose JSON-mode support was not confirmed in this stage remain
conservative: AI-LifeOS asks the model for JSON in the prompt and validates the
result, but does not send `response_format`. Manual model IDs also default to
text-only and no native JSON mode.

Anthropic uses the dedicated Messages protocol:

- endpoint: `https://api.anthropic.com/v1/messages`
- headers: `x-api-key` and `anthropic-version: 2023-06-01`
- response: text blocks from `content[]`
- JSON: prompt plus Schema validation; no unsupported `response_format`

## Connection Test

`POST /api/ai/providers/test` runs one explicit user-triggered request using
synthetic text. The test only succeeds when the selected provider returns a
valid JSON life-record payload containing both exercise and learning records.
An HTTP 200 response or a successful model-list request is not enough.

The route retains:

- trusted Host and Origin checks;
- request size limits;
- per-session rate limiting;
- single-process idempotency;
- public-beta request budgets;
- no automatic retry;
- no provider fallback.

## Security Boundary

- Client-provided Base URLs, endpoint fields, and URL aliases are rejected.
- The API key exists in React memory only unless the user explicitly enables
  session storage in the existing BYOK UI.
- The server does not persist provider keys.
- The key is sent upstream only in the provider's authentication header.
- The key is excluded from response bodies, diagnostics, and application logs.
- The same selected provider and model are carried through parsing, follow-up,
  and life-record analysis.
- Missing or rejected keys stop before any other provider is called.
- No real model was called during this implementation and test run.

## Vision Status

The registry records known vision-capable models for Qwen, OpenAI, Gemini, and
Anthropic. The current BYOK life-record flow sends text only. The UI now says
that the model is documented as supporting images but the current text flow
has not enabled image upload. Model metadata must not be read as an
end-to-end image capability claim.

## Test and Verification Boundary

Automated tests cover:

- all 17 fixed HTTPS registry entries;
- request-scoped provider/model selection;
- authentication headers and protocol-specific request bodies;
- structured-output capability metadata;
- connection tests for all 17 registered providers;
- multi-record parsing, smart follow-up, and data analysis through the same
  selected provider;
- 401, missing-key, timeout, quota, empty-response, and no-fallback behavior;
- key non-disclosure in bodies and responses.

Mock tests do not prove current account permissions, model availability,
regional access, or provider billing state. Those require the user's own key
and explicit authorization for a real call.

## Remaining Release Blockers

- Real API verification for each first-wave provider except TokenHub.
- Provider-specific model catalog refresh where an official list API is
  available.
- Shared atomic idempotency and rate-limit storage before multi-instance or
  serverless deployment.
- A separate, reviewed image-input pipeline before vision models can be
  advertised as end-to-end image support.
