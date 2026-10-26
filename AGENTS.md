# AGENTS.md: an OpenTrain kit project

This project was written by `opentrain kit init`. Claude Code and Codex both read this file.

## The loop

1. Edit what the template gives you:
   - a config project: `interface/config.xml` (the labeling interface: its objects, labels and rubric controls) and
     `fixtures/tasks/*.json` (sample tasks shaped like the config's `$variables`); in `interface/app/app.json`, edit
     only the `title` to retitle it (1-80 letters, digits, spaces, dots, dashes or underscores) and, when the template
     declares one, the `data` block with the controls it names;
   - `data` in `interface/app/app.json` is the bundle's DATA-01 and WORK-01 contract: its `modality`, the `annotate`
     and `submit` click selectors (clicked in that order), `visible` (an element that shows a task field) and `results`
     (each control that makes a result). Rename or remove a control and change `data` with it. With a block, a config
     project's kit refuses a task missing a field the config reads, or of another modality (`data.input_invalid`,
     `data.format_unsupported`), instead of showing an empty field; an app project's app answers those itself and
     restores its own draft. The platform serves a modality's tasks in one shape, so write `fixtures/tasks/*.json`
     and the config's `$variables` in it: a `text` task holds `text`, a string; an `llm-chat` task holds `dialog`, a
     list of `{"role", "content"}` entries (llm-chat-rubric reads it in its Chat, agent-trajectory-eval as one
     paragraph per step). kit check judges an `llm-chat` submission by that modality's result types, which do not yet
     take agent-trajectory-eval's step flags (its `ParagraphLabels`), so DATA-01 proves its overall outcome only until
     the platform adds them. kit check runs DATA-01's data cases for an inline modality, or image, video or audio;
     never for pdf;
   - an app project (custom widget): `interface/app/src/` (the app), `interface/app/app.json` (its title, CSP,
     channel and `data` block, which names the app's own controls) and `fixtures/tasks/*.json`.
   - a project with `workflow/pipeline.json`: that file is the project's workflow. Every file under `workflow/` must
     be named by the graph by its path inside `workflow/` (its `schemas` and each step's `fixtures`) with its digest,
     `sha256:` and the lowercase hex of the file's bytes, which `opentrain kit check` prints per file in its report's
     `digests.inputs`. `opentrain kit check` judges `workflow/` as the deploy's door does: a refusal is `INVALID_PARTS`,
     naming the file and the problem's code. After a person approves the change, the pipeline deploy checks what kit
     check does not, such as each human step's interface and the step cases' replay.
   - either way `fixtures/tasks/` is preview only, never deployed: a push never sends it, so the build must never
     read it (nor `AGENTS.md`, `dist/`, `ontology.json` or `workflow/`); kit check builds only what a push sends.
2. Run `opentrain kit check` in the project directory. It prints one JSON envelope. A passing run exits 0 and its
   `data` is the report, with `result` `pass`. A refused or incomplete run exits 1 with an error envelope, and the
   report is in `error.details` (`result` `refused` or `incomplete`).
3. On `refused`, read each refusal in `error.details.refusals` (`code`, `message`, `repairPath`, `detail`), fix exactly
   what `repairPath` says, and run `opentrain kit check` again. When the build failed, `detail` ends with the build's
   output, which names the file and the problem. On `incomplete`, read `error.details.incomplete`: it names the stage
   that could not run and why (for example the npm registry was unreachable); it is never a pass.
4. Repeat until `result` is `pass`.

## Rules

- Never edit `opentrain.project.json`, `package.json` or `package-lock.json` by hand: they are the template's. If the
  lock pair is damaged, `opentrain kit restore-lock` rewrites exactly those two files from the template and nothing else.
- Never edit `vendor/opentrain/` or a generated `interface/index.js`: the kit writes them.
- `notRunLocally[]` lists the admission cases this CLI cannot run on your machine; the Cloud still decides them.
- A production deploy that changes `workflow/pipeline.json` proposes the change to the workflow linked to the project:
  a person approves the proposal on the pipeline canvas and a builder deploy publishes it (`opentrain deploy status`
  names the next steps). With no linked workflow the deploy fails `deploy.workflow_unlinked`.
