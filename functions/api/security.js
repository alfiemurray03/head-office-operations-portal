import { json, requireSession } from "../_shared.js";

export const onRequestGet = async context => {
  const auth = await requireSession(context); if (auth.response) return auth.response;
  const [markers, restrictions] = await context.env.DB.batch([
    context.env.DB.prepare("SELECT m.marker_type,m.risk_level,m.status,m.review_at,c.customer_number FROM security_markers m JOIN customers c ON c.id=m.customer_id WHERE m.status IN ('active','under_review') ORDER BY m.created_at DESC LIMIT 100"),
    context.env.DB.prepare("SELECT r.restriction_type,r.scope,r.status,r.review_at,c.customer_number FROM restrictions r JOIN customers c ON c.id=r.customer_id WHERE r.status='active' ORDER BY r.applied_at DESC LIMIT 100")
  ]);
  return json({ markers: markers.results, restrictions: restrictions.results });
};
