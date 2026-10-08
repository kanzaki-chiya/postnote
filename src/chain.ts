/**
 * The ancestor path of a post, built only from verified parent ids.
 *
 * Position on the page, connector lines, author names, and "Replying to"
 * wording never enter here: they cannot distinguish an ancestor from a sibling
 * or from an unrelated recommendation. A chain is reported as incomplete rather
 * than guessed at.
 */

export type ChainOutcome = {
  /** Root first, the clicked post last. Always contains the clicked post. */
  ids: string[];
  complete: boolean;
  /** The post whose parent could not be established, when incomplete. */
  unresolvedFrom: string | null;
  reason: 'root' | 'unknown-parent' | 'cycle' | 'too-deep';
};

export type ParentLookup = (id: string) => string | null | undefined;

const MAX_ANCESTORS = 50;

export function ancestorPath(
  clickedId: string,
  parentOf: ParentLookup,
  limit = MAX_ANCESTORS,
): ChainOutcome {
  const path = [clickedId];
  const seen = new Set([clickedId]);
  let current = clickedId;

  for (let depth = 0; depth < limit; depth += 1) {
    const parent = parentOf(current);
    if (parent === undefined) {
      return { ids: path, complete: false, unresolvedFrom: current, reason: 'unknown-parent' };
    }
    if (parent === null) {
      return { ids: path, complete: true, unresolvedFrom: null, reason: 'root' };
    }
    if (seen.has(parent)) {
      return { ids: path, complete: false, unresolvedFrom: current, reason: 'cycle' };
    }
    path.unshift(parent);
    seen.add(parent);
    current = parent;
  }
  return { ids: path, complete: false, unresolvedFrom: current, reason: 'too-deep' };
}
