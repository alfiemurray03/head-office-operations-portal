import { error } from "../../_shared.js";

export const onRequestPost = async () => error(
  "LOCAL_LOGIN_DISABLED",
  "Head Office Portal access is available only through an individually authorised Microsoft Entra identity.",
  410
);
