---
name: opentrain-studio
description: Edit and check an OpenTrain kit project (opentrain kit init, opentrain kit check, opentrain kit restore-lock). Use when a project has opentrain.project.json.
---

# OpenTrain Studio: the kit loop

A kit project holds `opentrain.project.json` (schema `opentrain-kit-project/1`: name, template, kind `config` or `app`,
kitVersion, modules). `opentrain kit init <template> [<dir>]` writes one; `opentrain kit help` lists the templates.

1. Edit the interface (`interface/config.xml` for a config project, `interface/app/src/` for an app project) and the
   sample tasks in `fixtures/tasks/`. To retitle a config project, edit only the `title` in `interface/app/app.json`
   (1-80 letters, digits, spaces, dots, dashes or underscores).
2. Run `opentrain kit check`. It prints one `opentrain-cli-result/1` envelope whose data is an `opentrain-kit-check/1`
   report: `result` (`pass` | `refused` | `incomplete`), `refusals[]` (`code`, `gate`, `message`, `repairPath`, `detail`,
   `file`), `ran[]`, `incomplete[]` and `notRunLocally[]`. A refused or incomplete run exits 1 with the report in
   `error.details`. A `runtime.unpublished` refusal is the Cloud's deploy entry refusal, not an admission image case:
   its `image` is `entry` and its `case` `data-01--runtime-set`, and the Cloud returns only the code. An incomplete
   `data-01.runtime` stage means the kit tooling is not installed as published: run `opentrain kit setup`.
   When the push sends both `ontology.json` and `interface/config.xml` and a runtime was supplied, kit check judges the
   pair by the deploy plan's own rule: a pair the plan refuses is `deploy.ontology_config_mismatch` (`image` and `gate`
   `deploy-plan`, `case` `deploy--ontology-config-mismatch`, and the door's message as its `repairPath`). Pass
   `--project-type <type>` with the deploy target's project type when you know it. Without it every type is judged,
   only a pair no type admits refuses, and the `deploy-plan.ontology` entry of `ran[]` (added under
   `opentrain-kit-check/1`) lists each type's verdict. The repair is to make `ontology.json` describe `config.xml`'s
   controls, or to delete it (`config.xml` is served either way). kit check judges the bytes the push sends: by default
   your tracked edits; with `--commit` the commit's, refusing while a tracked change is uncommitted, as deploy does. An
   untracked `ontology.json` is never sent. The Cloud checks the configuration's kit tags first, which kit check cannot.
3. For each refusal, apply its `repairPath`, then run `opentrain kit check` again. Never edit the generated entry,
   `vendor/opentrain/`, the manifest or the lock pair; `opentrain kit restore-lock` restores the lock pair.
