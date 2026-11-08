import { describe, expect, it } from "vitest";
import { sameDialogEditors, type DialogEditors } from "./editor-model";
import { editorPlans } from "@/test/dialog-editor";

describe("declared editor identity", () => {
  it("compares every behavior-changing policy/key, but can ignore transient focus", () => {
    const original = editorPlans();
    const changes: ((plan: DialogEditors) => void)[] = [
      (p) => { p.ownerSignature = "successor"; },
      (p) => { p.answer!.clearKeys = ["Delete"]; },
      (p) => { p.answer!.commitKeys = ["Tab"]; },
      (p) => { p.answer!.normalize = "trim"; },
      (p) => { p.answer!.unchangedExit = "save"; },
      (p) => { p.answer!.return.keys = ["Up"]; },
      (p) => { p.answer!.return.repeat = "once"; },
      (p) => { p.answer!.read.endCell = "!"; },
      ...(["start", "end", "up", "left", "right"] as const).map((key) => (p: DialogEditors) => { p.answer!.read.keys = { ...p.answer!.read.keys, [key]: ["Delete"] }; }),
      ...(["start", "end", "up", "left", "right"] as const).map((key) => (p: DialogEditors) => { p.note!.read.keys = { ...p.note!.read.keys, [key]: ["Delete"] }; }),
      (p) => { p.answer!.read.whitespaceCells = [" "]; },
      (p) => { p.answer!.read.paintedSpace = "^"; },
      (p) => { p.note!.openKeys = ["m"]; },
      (p) => { p.note!.clearLineKeys = ["Backspace"]; },
      (p) => { p.note!.closeKeys = ["Tab"]; },
      (p) => { p.note!.normalize = "preserve"; },
      (p) => { p.note!.unchangedExit = "preserve"; },
      (p) => { p.note!.read.endCell = "_"; },
      (p) => { p.note!.read.whitespaceCells = ["~"]; },
      (p) => { p.note!.read.paintedSpace = "~"; },
    ];
    for (const change of changes) {
      const changed = editorPlans();
      change(changed);
      expect(sameDialogEditors(original, changed, false)).toBe(false);
    }
    const focused = editorPlans();
    focused.answer!.focusKeys = ["Up"];
    expect(sameDialogEditors(original, focused)).toBe(false);
    expect(sameDialogEditors(original, focused, false)).toBe(true);
    expect(sameDialogEditors(original, editorPlans())).toBe(true);
    expect(sameDialogEditors(undefined, undefined)).toBe(true);
    expect(sameDialogEditors(original, undefined)).toBe(false);
  });
});
