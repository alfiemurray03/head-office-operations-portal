import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/modal-system.css', import.meta.url), 'utf8');
const script = await readFile(new URL('../public/js/modal-system.js', import.meta.url), 'utf8');

assert.match(index, /modal-system\.css\?v=/, 'The shared modal stylesheet must be loaded.');
assert.match(index, /modal-system\.js\?v=/, 'The shared modal state repair must be loaded.');
assert.ok(
  index.indexOf('modal-system.css') > index.indexOf('enterprise.css'),
  'The modal repair stylesheet must load after the earlier design layers.'
);
assert.ok(
  index.indexOf('modal-system.js') > index.indexOf('operations-shell.js') &&
  index.indexOf('modal-system.js') < index.indexOf('boot.js'),
  'The modal state repair must run after the shell and before boot.'
);

assert.match(css, /dialog#modal[\s\S]*overflow:\s*hidden\s*!important/, 'The dialog must not create a horizontal scrollbar.');
assert.match(css, /\.modal-content[\s\S]*overflow-x:\s*hidden\s*!important/, 'Modal content must reject horizontal overflow.');
assert.match(css, /\.form-grid[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/, 'Desktop modal columns must be shrink-safe.');
assert.match(css, /fieldset[\s\S]*min-inline-size:\s*0/, 'Fieldsets must not force the modal wider than its viewport.');
assert.match(css, /input,[\s\S]*select,[\s\S]*textarea[\s\S]*max-width:\s*100%/, 'Form controls must remain within the modal.');
assert.match(css, /@media \(max-width:\s*820px\)[\s\S]*grid-template-columns:\s*1fr/, 'Smaller screens must use one form column.');

assert.match(script, /scrollLeft\s*=\s*0/, 'The reused modal must reset horizontal scroll.');
assert.match(script, /scrollTop\s*=\s*0/, 'The reused modal must reset vertical scroll.');
assert.match(script, /focus\(\{\s*preventScroll:\s*true\s*\}\)/, 'Focus must not scroll the modal sideways.');
assert.match(script, /requestAnimationFrame/, 'The reset must also run after browser layout and focus handling.');

console.log('Shared modal system regression checks passed.');
