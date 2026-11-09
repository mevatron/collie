// Optional observations/plans for native questionnaire editors. Pure data, never an answer store.
import { sameKeys, sameOptionalKeys } from "./prompt-model";

export interface EditorReadPlan {
  /** Measured cursor-only bindings, bound to the originating plan. */
  keys: { start: string[]; end: string[]; up: string[]; left: string[]; right: string[] };
  /** The painted, appended caret cell at a logical line's end. */
  endCell: string;
  /** Cells that need a cursor-only probe to distinguish wrapping whitespace. */
  whitespaceCells: string[];
  /** A breakable space is painted as this cell; omit when the caret is literal. */
  paintedSpace?: string;
}
export interface EditorContext {
  fixedSignature: string;
  /** Canonical, fully proved non-editor rows, in their native order. */
  rows: string[];
}
export interface EditorContextProjection extends EditorContext {
  clippedBefore: boolean;
  clippedAfter: boolean;
}
interface EditorPolicy {
  normalize: "preserve" | "trim";
  /** Return may save/normalize native text; it is never a rollback promise. */
  unchangedExit: "preserve" | "save";
  read: EditorReadPlan;
  /** Originating visible context; null means unproved, absence keeps the legacy exact check. */
  context?: EditorContext | null;
}
export interface DialogEditors {
  ownerSignature: string;
  answer?: EditorPolicy & { focusKeys: string[]; clearKeys: string[]; commitKeys?: string[]; return: { keys: string[]; repeat: "once" | "logical-lines" } };
  note?: EditorPolicy & { openKeys: string[]; clearLineKeys: string[]; closeKeys: string[] };
}

function sameEditorPolicy(a: EditorPolicy, b: EditorPolicy): boolean {
  return a.normalize === b.normalize && a.unchangedExit === b.unchangedExit &&
    a.read.endCell === b.read.endCell && a.read.paintedSpace === b.read.paintedSpace &&
    sameOptionalKeys(a.read.whitespaceCells, b.read.whitespaceCells) &&
    sameKeys(a.read.keys.start, b.read.keys.start) && sameKeys(a.read.keys.end, b.read.keys.end) &&
    sameKeys(a.read.keys.up, b.read.keys.up) && sameKeys(a.read.keys.left, b.read.keys.left) && sameKeys(a.read.keys.right, b.read.keys.right);
}

function sameContext(a: EditorContext | null | undefined, b: EditorContext | null | undefined): boolean {
  return a === undefined || a === null || b === undefined || b === null ? a === b :
    a.fixedSignature === b.fixedSignature && sameKeys(a.rows, b.rows);
}

/** Focus and its visible context are transient; measured clear/commit/close policies are not. */
export function sameDialogEditors(a: DialogEditors | undefined, b: DialogEditors | undefined, compareFocus = true): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.ownerSignature === b.ownerSignature &&
    (a.answer === undefined || b.answer === undefined ? a.answer === b.answer :
      sameEditorPolicy(a.answer, b.answer) &&
      a.answer.return.repeat === b.answer.return.repeat && sameOptionalKeys(a.answer.return.keys, b.answer.return.keys) &&
      (!compareFocus || sameOptionalKeys(a.answer.focusKeys, b.answer.focusKeys) && sameContext(a.answer.context, b.answer.context)) && sameOptionalKeys(a.answer.clearKeys, b.answer.clearKeys) && sameOptionalKeys(a.answer.commitKeys, b.answer.commitKeys)) &&
    (a.note === undefined || b.note === undefined ? a.note === b.note : sameEditorPolicy(a.note, b.note) &&
      (!compareFocus || sameContext(a.note.context, b.note.context)) && sameOptionalKeys(a.note.openKeys, b.note.openKeys) &&
      sameOptionalKeys(a.note.clearLineKeys, b.note.clearLineKeys) && sameOptionalKeys(a.note.closeKeys, b.note.closeKeys));
}

export interface DialogEditorObservation {
  purpose: "answer" | "question-note" | "global-note";
  layout: "inline" | "boxed";
  /** Question/step identity, independent of the editor's caret and value. */
  ownerSignature: string;
  /** Current non-editor chrome/choices/styles, stable across caret moves but not a successor. */
  contextSignature: string;
  /** Actual visible rows only; hidden rows are never reconstructed by the observer. */
  contextProjection?: EditorContextProjection;
  regionSignature: string;
  styledSignature?: string;
  /** Visible row text, without the input prefix; wrapping is not a logical newline. */
  rows: string[];
  /** UTF-16 offset within rows[row], not a display-column coordinate. */
  cursor: { row: number; offset: number; cell: string };
}
