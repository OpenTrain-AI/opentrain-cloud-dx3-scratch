// The custom widget: one text task, one choice, results sent once on submit.
// It answers DATA-01's data cases itself, as app.json's data block declares: a task of another modality gets
// data.format_unsupported and a text task with no string text gets data.input_invalid, each with no results, and
// the draft it saves (the choice) restores unchanged.
// ./ot-bootstrap.mjs is the platform's port bootstrap, added to the bundle when it is deployed (never built here).
import { port } from './ot-bootstrap.mjs';
import { DATA_ERROR_CODES, createPortChannel } from './port-client.mjs';

const CHOICES = ['Positive', 'Negative', 'Neutral'];
const channel = createPortChannel({ port });
const root = document.getElementById('root') ?? document.body;

channel.init(({ taskData, params, draft }) => {
  root.replaceChildren();
  // The platform names a task's modality in params.dataModality; a task with none is this app's own (text).
  const modality = params?.dataModality ?? 'text';
  if (modality !== 'text') {
    channel.reportError(
      DATA_ERROR_CODES.formatUnsupported,
      `this app reads text tasks, not ${modality}`
    );
    return;
  }
  if (typeof taskData?.text !== 'string') {
    channel.reportError(DATA_ERROR_CODES.inputInvalid, 'the task has no text to read');
    return;
  }
  let chosen = CHOICES.includes(draft?.choice) ? draft.choice : null;
  let sent = false;
  const text = document.createElement('p');
  text.textContent = taskData.text;
  const choices = document.createElement('fieldset');
  for (const value of CHOICES) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'sentiment';
    input.value = value;
    input.checked = value === chosen;
    input.addEventListener('change', () => {
      chosen = value;
    });
    label.append(input, ` ${value}`);
    choices.append(label);
  }
  const submit = document.createElement('button');
  submit.type = 'button';
  submit.textContent = 'Submit';
  submit.addEventListener('click', () => {
    if (chosen === null || sent) return;
    sent = true;
    channel.sendResults([
      {
        from_name: 'sentiment',
        to_name: 'text',
        type: 'choices',
        value: { choices: [chosen] },
      },
    ]);
  });
  // The shell asks for the draft; with no choice made there is nothing to save.
  channel.onDraftRequest(() => (chosen === null ? undefined : { choice: chosen }));
  root.append(text, choices, submit);
  channel.reportActivity('READINESS');
});
