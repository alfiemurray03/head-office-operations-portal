import { microsoftLogout } from "../../../_microsoft-auth.js";

export const onRequestGet = async ({ request }) => microsoftLogout(request);
