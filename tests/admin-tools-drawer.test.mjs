import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index, styles, boot, operationsShell] = await Promise.all([
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/professional-interface.css', import.meta.url), 'utf8'),
  readFile(new URL('../public/js/boot.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/js/operations-shell.js', import.meta.url), 'utf8')
]);

assert.match(index, /id="menuButton"[^>]+aria-controls="sidebar"/, 'The All admin tools button must control the drawer.');
assert.doesNotMatch(boot, /menuButton[\s\S]*classList\.toggle\('open'\)/, 'The replaceable header button must not own the drawer listener.');
assert.match(operationsShell, /event\.target\.closest\("#menuButton"\)[\s\S]*stopImmediatePropagation\(\)[\s\S]*toggleOperationsTools\(\)[\s\S]*}, true\)/, 'A durable capture-phase handler must toggle the drawer exactly once.');
assert.match(operationsShell, /classList\.toggle\("open", open\)[\s\S]*aria-expanded/, 'The drawer state and accessibility state must change together.');
assert.match(styles, /@media \(min-width: 900px\)[\s\S]*grid-template-columns:\s*248px minmax\(0, 1fr\) !important/, 'Desktop must reserve a stable navigation column instead of shifting the page.');
assert.match(styles, /body\.ops-tailwind \.tools-drawer\s*\{[\s\S]*position:\s*sticky !important[\s\S]*opacity:\s*1 !important[\s\S]*pointer-events:\s*auto !important/, 'Desktop navigation must remain visible and interactive without an opening animation.');
assert.match(styles, /body\.ops-tailwind \.drawer-close,[\s\S]*body\.ops-tailwind \.all-tools-button,[\s\S]*display:\s*none !important/, 'The drawer trigger must be reserved for the responsive mobile shell.');
assert.doesNotMatch(styles, /#sidebar\.tools-drawer\s*\{[\s\S]*visibility:\s*hidden !important/, 'A later override must not collapse the desktop navigation after first paint.');

console.log('Stable Head Office navigation regression checks passed.');
