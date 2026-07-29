import { cleanText, json } from "../_shared.js";
import { requirePermission } from "../_operations.js";
import { ensureMarkerReference, ensureSecurityControlPlane } from "../_security-control-plane.js";

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "security:read");
  if (auth.response) return auth.response;
  await ensureSecurityControlPlane(context.env);
  const url = new URL(context.request.url);
  const query = cleanText(url.searchParams.get("q") || "", 100);
  const search = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const [markers, restrictions, markerTypes, restrictionTypes, counts] = await context.env.DB.batch([
    context.env.DB.prepare(`SELECT m.id,m.marker_type,t.label marker_label,d.marker_code,d.category,d.crm_display_label,d.branch_instruction,d.site_enforcement,
      mr.marker_reference,m.risk_level,m.reason,m.visibility,m.status,m.review_at,m.expires_at,m.created_at,
      c.id customer_id,c.customer_number,c.display_name customer_name,k.id case_id,k.case_reference
      FROM security_markers m JOIN customers c ON c.id=m.customer_id
      LEFT JOIN cases k ON k.id=m.case_id LEFT JOIN security_marker_types t ON t.code=m.marker_type
      LEFT JOIN security_marker_definitions d ON d.marker_type=m.marker_type
      LEFT JOIN security_marker_references mr ON mr.marker_id=m.id
      WHERE (?='' OR c.customer_number LIKE ? ESCAPE '\\' OR c.display_name LIKE ? ESCAPE '\\'
        OR m.marker_type LIKE ? ESCAPE '\\' OR d.marker_code LIKE ? ESCAPE '\\' OR mr.marker_reference LIKE ? ESCAPE '\\')
      ORDER BY CASE m.status WHEN 'active' THEN 1 WHEN 'under_review' THEN 2 ELSE 3 END,
        CASE m.risk_level WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'moderate' THEN 3 ELSE 4 END,m.created_at DESC LIMIT 200`)
      .bind(query, search, search, search, search, search),
    context.env.DB.prepare(`SELECT r.id,r.restriction_type,t.label restriction_label,t.enforcement_action,r.scope,r.reason,r.status,r.review_at,r.expires_at,r.applied_at,
      c.id customer_id,c.customer_number,c.display_name customer_name,k.id case_id,k.case_reference
      FROM restrictions r JOIN customers c ON c.id=r.customer_id
      LEFT JOIN cases k ON k.id=r.case_id LEFT JOIN restriction_types t ON t.code=r.restriction_type
      WHERE (?='' OR c.customer_number LIKE ? ESCAPE '\\' OR c.display_name LIKE ? ESCAPE '\\' OR r.restriction_type LIKE ? ESCAPE '\\')
      ORDER BY CASE r.status WHEN 'active' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,r.applied_at DESC LIMIT 200`)
      .bind(query, search, search, search),
    context.env.DB.prepare(`SELECT t.*,d.marker_code,d.category,d.crm_display_label,d.branch_instruction,d.site_enforcement
      FROM security_marker_types t LEFT JOIN security_marker_definitions d ON d.marker_type=t.code
      WHERE t.status='active' ORDER BY COALESCE(d.crm_display_label,t.label)`),
    context.env.DB.prepare("SELECT * FROM restriction_types WHERE status='active' ORDER BY label"),
    context.env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM security_markers WHERE status IN ('active','under_review')) active_markers,
      (SELECT COUNT(*) FROM security_markers WHERE status IN ('active','under_review') AND risk_level='critical') critical_markers,
      (SELECT COUNT(*) FROM restrictions WHERE status='active') active_restrictions,
      (SELECT COUNT(*) FROM security_markers WHERE status IN ('active','under_review') AND review_at<?) overdue_reviews`).bind(new Date().toISOString())
  ]);

  for (const marker of markers.results || []) {
    if (!marker.marker_reference) marker.marker_reference = await ensureMarkerReference(context.env, marker.id, marker.marker_type);
    if (!marker.marker_code) marker.marker_code = marker.marker_type;
    if (!marker.crm_display_label) marker.crm_display_label = marker.marker_label || marker.marker_type;
  }

  return json({
    markers: markers.results || [],
    restrictions: restrictions.results || [],
    markerTypes: markerTypes.results || [],
    restrictionTypes: restrictionTypes.results || [],
    metrics: counts.results?.[0] || {}
  }, 200, { "Cache-Control": "no-store" });
};
