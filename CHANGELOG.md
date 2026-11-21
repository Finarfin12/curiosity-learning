# Changelog

## 0.5.0

- Add **Antigravity CLI** (`agy`) as a Desktop CLI provider, detected automatically. Its models come from `agy models` (`id<TAB>name` lines): the dropdown shows the names and saves the ids. If `agy` is missing, fails or times out (15 s), the provider shows **Not connected · Unavailable** with no models. No model names are hardcoded.
- **Antigravity is detect-only.** The models are listed, but questions are never run through it: no verified flag turns all its tools off. Checked on the developer PC with `agy` 1.5.14: `--help` has no tools-off flag (`--sandbox` only restricts the terminal; `--mode plan` prints "has no effect while slash command expansion is disabled", and slash commands must stay disabled; the keys of `--settings` are not documented). Real runs with `-p --output-format json --disable-slash-commands --sandbox` still wrote a file and ran a shell command, and with `--settings {"toolPermission":"request-review","allowNonWorkspaceAccess":false}` it still wrote a file and read a file outside its workspace. The required flags (`-p`, `--output-format json`, `--disable-slash-commands`, `--sandbox`) and the forbidden ones (`--dangerously-skip-permissions`, `--continue`/`-c`, `--conversation`, `--remote-control`, `--prompt-interactive`, `--remote-agent`, `--add-dir`, ...) are enforced by a guard and tests, so enabling it later only needs a verified tools-off setting.
- Gemini CLI is unchanged and still works where installed; on a PC without it, it shows **Unavailable** with no invented models. Claude Code, Codex CLI and Ollama behave as in 0.4.4.
- Disclosure: for Antigravity the plugin runs `agy models` locally in an empty temporary folder (it may contact Antigravity's own service). Nothing else is run for it, and the plugin sends no note content to it.
- Type check as the Obsidian review bot sees it: `src/` is checked without `@types/node` (own minimal Node types in `runner.ts`); tests are checked by `tsconfig.tests.json` in `npm run build`.
- Release workflow: a version tag builds the release files from the tagged commit, runs the tests, creates GitHub artifact attestations for `main.js`, `manifest.json` and `styles.css`, and publishes the release. The lockfile is unchanged apart from the version.

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
