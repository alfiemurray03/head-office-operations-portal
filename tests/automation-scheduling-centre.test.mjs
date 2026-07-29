import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateNextRun, AUTOMATION_JOB_CATALOG } from '../functions/_automation-scheduler.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [migration, scheduler, api, tick, worker, workerConfig, boot, ui, css, settings, settingsExtension] = await Promise.all([
  read('migrations/0017_automation_scheduling_centre.sql'),
  read('functions/_automation-scheduler.js'),
  read('functions/api/automation-schedules.js'),
  read('functions/api/automation/scheduler/tick.js'),
  read('workers/customer-directory-automation.js'),
  read('wrangler.customer-directory.jsonc'),
  read('public/js/boot.js'),
  read('public/js/automation-centre.js'),
  read('public/automation-centre.css'),
  read('functions/_system-settings.js'),
  read('public/js/automation-settings-extension.js')
]);

for (const table of ['automation_schedules', 'automation_runs']) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`), `${table} must be created by migration 0017.`);
  assert.match(scheduler, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`), `${table} must have runtime readiness protection.`);
}

for (const setting of [
  'automation.scheduler_enabled',
  'automation.default_timezone',
  'automation.max_jobs_per_tick',
  'automation.default_retry_delay_minutes',
  'automation.run_retention_days'
]) assert.match(settings, new RegExp(setting.replaceAll('.', '\\.')), `${setting} must be governed in System Settings.`);

for (const code of [
  'customer_directory_sync', 'staff_directory_sync', 'stripe_reconciliation',
  'system_tests_all', 'service_health_test', 'webhook_health_test',
  'connected_systems_health_test', 'security_control_health_test', 'evidence_retention_cleanup'
]) assert.ok(AUTOMATION_JOB_CATALOG.some(job => job.code === code), `${code} must be a registered scheduler job.`);

assert.doesNotMatch(scheduler, /lockdown.*job|job.*lockdown/i, 'Critical lockdown must never become a schedulable job.');
assert.doesNotMatch(scheduler, /arbitrary.*url|eval\s*\(|new Function/i, 'The scheduler must not execute arbitrary URLs or code.');
assert.match(api, /requirePermission\(context, "configuration:write"\)/, 'Schedule changes must require configuration write authority.');
assert.match(api, /automation\.schedule_created/, 'Schedule creation must be audited.');
assert.match(tick, /AUTOMATION_SECRET/, 'Scheduler cycles must require the automation credential.');
assert.match(worker, /\/api\/automation\/scheduler\/tick/, 'The Worker must execute the governed scheduler tick endpoint.');
assert.match(workerConfig, /"\* \* \* \* \*"/, 'The Worker must offer one-minute scheduler resolution.');
assert.match(boot, /loadAutomationCentreModule/, 'The Automation and Scheduling Centre must load during authorised startup.');
assert.match(boot, /loadAutomationSettingsExtension/, 'Scheduler controls must be loaded into the existing System Settings workspace.');
assert.match(boot, /automation-settings-extension\.js/, 'The settings extension asset must be requested after System Control loads.');
assert.match(boot, /automation-centre/, 'The complete page index must expose the Automation and Scheduling Centre.');
assert.match(ui, /Automation &amp; Scheduling Centre/, 'The full scheduling workspace must be rendered.');
assert.match(ui, /Create schedule/, 'Authorised staff must be able to create schedules.');
assert.match(ui, /Run now/, 'Authorised staff must be able to run approved automation manually.');
assert.match(ui, /Test/, 'Schedule configuration must expose a safe test action.');
assert.match(css, /automation-schedule-row/, 'Schedules must use the dedicated responsive Planyx-aligned layout.');
assert.match(settingsExtension, /automation\.scheduler_enabled/, 'System Settings must expose the global scheduler switch.');

const interval = calculateNextRun('interval', { intervalMinutes: 60 }, 'Europe/London', new Date('2026-01-01T00:00:00.000Z'));
assert.equal(interval, '2026-01-01T01:00:00.000Z');
const daily = calculateNextRun('daily', { time: '09:00' }, 'Europe/London', new Date('2026-01-01T08:00:00.000Z'));
assert.equal(daily, '2026-01-01T09:00:00.000Z');
const summerDaily = calculateNextRun('daily', { time: '09:00' }, 'Europe/London', new Date('2026-07-01T07:00:00.000Z'));
assert.equal(summerDaily, '2026-07-01T08:00:00.000Z', 'Europe/London schedules must follow British Summer Time.');

console.log('Automation and Scheduling Centre regression checks passed.');
