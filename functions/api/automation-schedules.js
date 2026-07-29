import { audit, cleanText, error, json, readJson } from "../_shared.js";
import { requirePermission } from "../_operations.js";
import {
  automationCentreSnapshot,
  createAutomationSchedule,
  deleteAutomationSchedule,
  ensureAutomationSchedulerReady,
  runAutomationScheduleNow,
  setAutomationScheduleStatus,
  updateAutomationSchedule
} from "../_automation-scheduler.js";

async function authorised(context, permission) {
  const auth = await requirePermission(context, permission);
  if (auth.response) return auth;
  await ensureAutomationSchedulerReady(context.env);
  return auth;
}

export const onRequestGet = async context => {
  const auth = await authorised(context, "configuration:read");
  if (auth.response) return auth.response;
  try {
    return json(await automationCentreSnapshot(context.env), 200, { "Cache-Control": "no-store" });
  } catch (cause) {
    return error(cause.code || "AUTOMATION_CENTRE_LOAD_FAILED", cause.message || "The Automation and Scheduling Centre could not be loaded.", cause.status || 500);
  }
};

export const onRequestPost = async context => {
  const auth = await authorised(context, "configuration:write");
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request, 128_000); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }

  const action = cleanText(body.action || "create", 40);
  try {
    if (action === "create") {
      const schedule = await createAutomationSchedule(context.env, body.schedule || body, auth.session);
      await audit(context.env, auth.session, "automation.schedule_created", "automation_schedule", schedule.id, {
        label: "Automation schedule created",
        reference: schedule.name,
        requestId: context.data.requestId,
        after: { jobCode: schedule.job_code, scheduleKind: schedule.schedule_kind, nextRunAt: schedule.next_run_at }
      });
      return json({ created: true, schedule }, 201);
    }

    const id = cleanText(body.id, 100);
    if (!id) return error("SCHEDULE_ID_REQUIRED", "Select an automation schedule.", 400);

    if (action === "run" || action === "test" || action === "retry") {
      const result = await runAutomationScheduleNow(context.env, id, auth.session, context.data.requestId, {
        testOnly: action === "test",
        retry: action === "retry"
      });
      await audit(context.env, auth.session, `automation.schedule_${action}`, "automation_schedule", id, {
        label: action === "test" ? "Automation configuration tested" : action === "retry" ? "Automation run retried" : "Automation run started manually",
        reference: id,
        requestId: context.data.requestId,
        after: { runId: result.runId, status: result.status }
      });
      return json(result);
    }

    if (["enable", "pause", "disable"].includes(action)) {
      const targetStatus = action === "enable" ? "enabled" : action === "pause" ? "paused" : "disabled";
      const schedule = await setAutomationScheduleStatus(context.env, id, targetStatus, auth.session);
      await audit(context.env, auth.session, "automation.schedule_status_changed", "automation_schedule", id, {
        label: "Automation schedule status changed",
        reference: schedule.name,
        requestId: context.data.requestId,
        after: { status: schedule.status, nextRunAt: schedule.next_run_at }
      });
      return json({ updated: true, schedule });
    }

    return error("AUTOMATION_ACTION_NOT_SUPPORTED", "That automation action is not supported.", 400);
  } catch (cause) {
    return error(cause.code || "AUTOMATION_ACTION_FAILED", cause.message || "The automation action could not be completed.", cause.status || 500, cause.details);
  }
};

export const onRequestPut = async context => {
  const auth = await authorised(context, "configuration:write");
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request, 128_000); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const id = cleanText(body.id, 100);
  if (!id) return error("SCHEDULE_ID_REQUIRED", "Select an automation schedule.", 400);
  try {
    const before = await context.env.DB.prepare("SELECT name,job_code,status,schedule_kind,timezone,schedule_json,parameters_json,next_run_at FROM automation_schedules WHERE id=?").bind(id).first();
    const schedule = await updateAutomationSchedule(context.env, id, body.schedule || body, auth.session);
    await audit(context.env, auth.session, "automation.schedule_updated", "automation_schedule", id, {
      label: "Automation schedule updated",
      reference: schedule.name,
      requestId: context.data.requestId,
      before,
      after: { name: schedule.name, jobCode: schedule.job_code, status: schedule.status, scheduleKind: schedule.schedule_kind, timezone: schedule.timezone, nextRunAt: schedule.next_run_at }
    });
    return json({ updated: true, schedule });
  } catch (cause) {
    return error(cause.code || "AUTOMATION_UPDATE_FAILED", cause.message || "The automation schedule could not be updated.", cause.status || 500, cause.details);
  }
};

export const onRequestDelete = async context => {
  const auth = await authorised(context, "configuration:write");
  if (auth.response) return auth.response;
  const id = cleanText(new URL(context.request.url).searchParams.get("id"), 100);
  if (!id) return error("SCHEDULE_ID_REQUIRED", "Select an automation schedule.", 400);
  try {
    const before = await context.env.DB.prepare("SELECT name,job_code,status,next_run_at FROM automation_schedules WHERE id=?").bind(id).first();
    await deleteAutomationSchedule(context.env, id);
    await audit(context.env, auth.session, "automation.schedule_deleted", "automation_schedule", id, {
      label: "Automation schedule deleted",
      reference: before?.name || id,
      requestId: context.data.requestId,
      before
    });
    return json({ deleted: true });
  } catch (cause) {
    return error(cause.code || "AUTOMATION_DELETE_FAILED", cause.message || "The automation schedule could not be deleted.", cause.status || 500, cause.details);
  }
};
