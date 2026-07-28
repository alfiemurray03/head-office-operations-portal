import { json, requirePlatform } from "../../../_shared.js";

export const onRequestGet = async context => {
  const auth = await requirePlatform(context); if (auth.response) return auth.response;
  return json({ ok: true, apiVersion: "v1", platform: { code: auth.platform.code, name: auth.platform.name }, serverTime: new Date().toISOString() });
};
