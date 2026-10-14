import type { Activity, ActivityId } from '../types';
import { DOC_AI } from './documentAi';
import { ETHICS } from './ethics';

export { AI_CHECKS } from './aiChecks';
export { DOC_AI, ETHICS };

export const ACTIVITIES: Record<ActivityId, Activity> = { ethics: ETHICS, 'document-ai': DOC_AI };
