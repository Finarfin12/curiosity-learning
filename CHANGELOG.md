# Changelog

## 0.4.4

- Streamline devDependencies and lockfile for reliable community scanner dependency installation.

## 0.4.3

- Remove all hardcoded AI model lists and auto-detect models directly from each available provider (Codex `models_cache.json`/`config.toml`, Claude `--help`/binary/`settings.json`, Gemini CLI binary/`settings.json`, Ollama `ollama list`/`/api/tags`, LM Studio `/v1/models`, and Cloud API `/v1/models` or `/v1beta/models`).
- Show live AI connection status and popup notices (`Connected` / `Not connected`) when switching modes/providers, editing endpoints or API keys, or clicking **Check connection and detect models**.
- Return empty model lists for unavailable providers or Cloud API without an API key.

## 0.4.2

- Add automatic Obsidian Templates support (`Curiosity Learning Topic.md` and `Curiosity Learning Inbox.md`) via first-run prompt, **Settings → Templates**, and the **Create templates** command without overwriting existing files.
- Exclude template files from the Learning Queue and auto-initialize new notes created from Curiosity Learning templates.

## 0.4.1

- Replace the manual AI model text box with an automatic provider model dropdown across Desktop CLI, Local HTTP, and Cloud API.
- Adopt declarative `getSettingDefinitions()` for Obsidian 1.13+ settings search and upgrade `eslint-plugin-obsidianmd` to `0.5.1`.

## 0.4.0

- Add opt-in desktop CLI, loopback HTTP, and cloud API learning providers.
- Require per-request context consent and explicit acceptance of validated AI output.
- Add AI teaching, focused diagnostic questions, equivalent practice problems, and evidence-labeled evaluation.
- Give long answers full-width editors and separate AI consent from result review.

## 0.3.0

- Add editable prerequisite links, readiness indicators, and navigation to linked learning notes.
- Add confirmed Curiosity Capture imports and duplicate prevention.
- Use English by default and flat, customizable note properties with migration for legacy notes.

## 0.2.0

- Opt-in search across five scholarly sources, manual DOI/URL checks, and source metadata in evidence callouts.
- Three levels of worked examples, a bilingual Devil’s advocate mode, and interleaved FSRS review.

## 0.1.0

- Local learning workflow with a prior guess, rule-based Feynman checks, Socratic prompts, and a before/after post-test.
- Confidence calibration, misconception ledger, and five evidence-labeled scores.
- Internal FSRS-5 card review with same-session relearning.
- English and Indonesian interface, configurable folders, and non-destructive Markdown updates.
