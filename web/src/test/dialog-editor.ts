import type { DialogEditors, EditorReadPlan } from "@/lib/harness/editor-model";
import type { PreviewSelectModel } from "@/lib/harness/preview-model";

export function editorPlans(): DialogEditors {
  return {
    ownerSignature: "question-1",
    answer: {
      focusKeys: ["Down"], clearKeys: ["ctrl+u"], commitKeys: ["Enter"],
      normalize: "preserve", unchangedExit: "preserve",
      return: { keys: ["Home", "Up"], repeat: "logical-lines" },
      read: { endCell: "_", whitespaceCells: ["~"], paintedSpace: "~", keys: editorKeys },
    },
    note: {
      openKeys: ["n"], clearLineKeys: ["ctrl+u"], closeKeys: ["Escape"],
      normalize: "trim", unchangedExit: "save",
      read: { endCell: " ", whitespaceCells: [" "], keys: editorKeys },
    },
  };
}

export function editorDialog(): PreviewSelectModel {
  return {
    question: "Choose a design", coreSignature: "design-question", regionSignature: "dialog", styledSignature: "dialog-style",
    options: [{ n: 1, label: "Simple", pointed: true, chosen: false, keys: ["Enter"] }],
    steps: null, preview: [], note: { state: "attached", text: "summary", textComplete: false },
    field: { n: 2, text: "summary", focused: false, lines: 1, multiline: true, textComplete: false },
    editors: editorPlans(),
  };
}
export const editorKeys: EditorReadPlan["keys"] = {
  start: ["Home"], end: ["End"], up: ["Up"], left: ["Left"], right: ["Right"],
};
