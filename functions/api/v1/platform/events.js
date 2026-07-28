import { error, json, readJson, requirePlatform } from "../../../_shared.js";
import { ingestSecurityEvent } from "../../../_risk-engine.js";

export const onRequestPost=async context=>{
  const auth=await requirePlatform(context,["events:write"]);if(auth.response)return auth.response;
  let body;try{body=await readJson(context.request,64_000);}catch(cause){return error(cause.code||"INVALID_REQUEST",cause.message,cause.status||400);}
  try{
    const result=await ingestSecurityEvent(context.env,{...body,platformId:auth.platform.id,sourceType:"platform"},{type:"platform",id:auth.platform.id,name:auth.platform.name,platformId:auth.platform.id});
    return json(result,result.duplicate?200:202);
  }catch(cause){return error(cause.code||"EVENT_PROCESSING_FAILED",cause.message||"The platform event could not be processed.",cause.status||400);}
};
