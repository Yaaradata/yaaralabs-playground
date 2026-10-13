/**
 * Which editor a Rule Based Process project opens in. The backend stores the choice on the project
 * as `rbpEditor` (backend/app/services/scratch_project_service.py):
 *
 *   blocks     the block editor (components/RuleBasedProcess, the same editor as Exercise 1). New
 *              projects get this.
 *   legacy     the same block editor, for projects that had a workspace before "blocks" existed.
 *   scratch    built in the external Scratch editor: kept there so no work is lost.
 *   rules-bot  the keyword rules board (components/RulesBot). Parked: its code is kept for reuse,
 *              but these projects open in the block editor while RULES_BOT_ENABLED is false.
 */

export type RbpEditorValue = 'blocks' | 'legacy' | 'scratch' | 'rules-bot';

/** What the project page renders. */
export type RbpEditorView = 'blocks' | 'scratch' | 'rules-bot';

/** Set to true to open 'rules-bot' projects in the Rules Bot board again. */
export const RULES_BOT_ENABLED = false;

export function resolveRbpEditor(value: string | null | undefined): RbpEditorView {
  if (value === 'scratch') return 'scratch';
  if (value === 'rules-bot' && RULES_BOT_ENABLED) return 'rules-bot';
  return 'blocks';
}
