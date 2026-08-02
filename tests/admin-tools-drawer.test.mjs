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
assert.match(styles, /#sidebar\.tools-drawer\s*\{[\s\S]*visibility:\s*hidden !important/, 'The desktop drawer must have a closed state.');
assert.match(styles, /#sidebar\.tools-drawer\.open\s*\{[\s\S]*visibility:\s*visible !important[\s\S]*pointer-events:\s*auto !important/, 'The desktop drawer must have an interactive open state.');
assert.match(styles, /#menuButton\.all-tools-button[\s\S]*display:\s*inline-flex !important/, 'The desktop trigger must remain visible.');

console.log('All admin tools drawer regression checks passed.');
