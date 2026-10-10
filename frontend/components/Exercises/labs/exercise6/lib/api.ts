import { embedLab } from '../../../api';
import type { EmbedResult } from '../../../types';

export type HostedEmbedModel =
  | 'text-embedding-005'
  | 'text-embedding-004'
  | 'text-multilingual-embedding-002'
  | 'gemini-embedding-001';

export async function embedViaPlayground(
  sessionId: string,
  projectId: string,
  texts: string[],
  model: HostedEmbedModel,
): Promise<EmbedResult> {
  return embedLab(sessionId, projectId, texts, model);
}
