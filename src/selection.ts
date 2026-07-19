export type SelectableMedia = {
  id: number;
  missing?: boolean;
};

export type SelectionModifiers = {
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
};

export type SelectionTransition = {
  selectedIds: number[];
  anchorId: number;
};

/**
 * Applies standard desktop list-selection semantics without depending on React.
 * Keeping this transition pure makes selection behavior portable and testable.
 */
export function applyMediaSelection(
  currentIds: readonly number[],
  anchorId: number | null,
  targetId: number,
  collection: readonly SelectableMedia[],
  modifiers: SelectionModifiers = {}
): SelectionTransition {
  const additive = Boolean(modifiers.metaKey || modifiers.ctrlKey);

  if (modifiers.shiftKey && anchorId !== null) {
    const anchorIndex = collection.findIndex((item) => item.id === anchorId);
    const targetIndex = collection.findIndex((item) => item.id === targetId);
    if (anchorIndex >= 0 && targetIndex >= 0) {
      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      const rangeIds = collection
        .slice(start, end + 1)
        .filter((item) => !item.missing)
        .map((item) => item.id);
      return {
        selectedIds: additive ? [...new Set([...currentIds, ...rangeIds])] : rangeIds,
        anchorId
      };
    }
  }

  if (additive) {
    return {
      selectedIds: currentIds.includes(targetId)
        ? currentIds.filter((id) => id !== targetId)
        : [...currentIds, targetId],
      anchorId: targetId
    };
  }

  return { selectedIds: [targetId], anchorId: targetId };
}

