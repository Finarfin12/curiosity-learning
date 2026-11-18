---
name: curiosity-skill
description: Work with Curiosity Learning notes in an explicitly selected Obsidian vault.
---

## Obsidian compatibility

Operate only on an explicitly selected Markdown note with `type: learning` and the Curiosity Learning metadata comment, or a legacy note with `cl_schema: 1` and `cl_kind: learning`. Skip notes with `type: idea` or `type: concept`. Respect the learner's vault and sharing permissions. Preserve custom frontmatter and free-form Markdown.

Append `[!cl-teach]` for a teaching explanation, `[!cl-probe]` for a question and response, `[!cl-feedback]` for a comparison, `[!cl-evidence]` for sources, and `[!cl-misconception]` for a misconception and its correction. Leave scheduling metadata in `[!cl-card]` and `[!cl-review]` to the plugin.

Update only the demonstrated axis. For flat properties, follow the property map in the metadata comment and store an observed AI score as `2 (ai)` when the score is 2. For legacy notes, use `source: observed_ai` in `cl_axes`. Keep untouched axes `not_tested`. Preserve the metadata comment and record the date in its corresponding axis date field. Never infer delayed retention from a same-day answer.
