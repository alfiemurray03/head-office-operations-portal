import { json } from "../_shared.js";
import { requirePermission } from "../_operations.js";

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "approvals:read");
  if (auth.response) return auth.response;
  const result = await context.env.DB.prepare(`SELECT a.*,c.case_reference,c.title case_title,u.customer_number,u.display_name customer_name,
    requester.display_name requested_by_name,decider.display_name decided_by_name
    FROM approval_requests a LEFT JOIN cases c ON c.id=a.case_id LEFT JOIN customers u ON u.id=c.customer_id
    LEFT JOIN staff_members requester ON requester.id=a.requested_by LEFT JOIN staff_members decider ON decider.id=a.decided_by
    ORDER BY CASE a.status WHEN 'pending' THEN 1 ELSE 2 END,a.requested_at DESC LIMIT 200`).all();
  return json({ approvals: result.results });
};
