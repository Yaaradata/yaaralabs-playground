'use client';

import { useCallback, useRef, useState } from 'react';
import { createUndoStack, type UndoStackOptions } from './undoHistory';

/** React hook: push snapshots before mutations, undo restores the previous one. */
export function useUndoHistory<T>(options?: UndoStackOptions) {
  const stackRef = useRef(createUndoStack<T>(options));
  const [canUndo, setCanUndo] = useState(false);

  const push = useCallback((snapshot: T) => {
    stackRef.current.push(snapshot);
    setCanUndo(true);
  }, []);

  const undo = useCallback((): T | undefined => {
    const prev = stackRef.current.undo();
    setCanUndo(stackRef.current.canUndo);
    return prev;
  }, []);

  const clear = useCallback(() => {
    stackRef.current.clear();
    setCanUndo(false);
  }, []);

  return { push, undo, canUndo, clear, size: () => stackRef.current.size };
}
