import { ensureApprovedSupportPlatforms } from '../../_support-platform-registration.js';
import { onRequestGet as getBranchControls } from './[[path]].js';

export const onRequestGet = async context => {
  await ensureApprovedSupportPlatforms(context.env);
  return getBranchControls({
    ...context,
    params: { ...(context.params || {}), path: ['branches'] },
  });
};
