import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MultiSelectModel } from "./blocks";
import { editorDialog } from "@/test/dialog-editor";
vi.mock("./api", () => ({ fetchPane: vi.fn(), sendKeys: vi.fn(), sendReply: vi.fn() }));
const harness = vi.hoisted(() => ({ blocks: vi.fn() }));
vi.mock("./harness/registry", () => ({ adapterFor: () => ({ buildBlocks: harness.blocks }) }));
import { fetchPane, sendKeys, sendReply } from "./api";
import { submitMultiSelectIntent } from "./multi-select-action";
import { submitPreviewNote, submitPreviewOption } from "./preview-action";
import { previewsEqual, previewCoreEqual } from "./harness/preview-model";
import { multiSelectEquals, multiSelectIdentity } from "./harness/multi-select-model";

const base = { paneId: "w1:p1", requestedLines: 80, detectedRevision: 0, agent: "synthetic", sleep: async () => {} };
function checkbox(): Extract<MultiSelectModel, { phase: "checkbox" }> {
  return { phase: "checkbox", question: "Choose", options: [{ n: 1, label: "One", checked: false }, { n: 2, label: "Two", checked: false }],
    escape: null, pointer: "option", pointerRow: 1, steps: null, advanceLabel: "Next", toggle: "walk",
    signature: "choices", regionSignature: "first", styledSignature: "first-style", cancelKeys: ["Escape"] };
}
beforeEach(() => {
  vi.mocked(fetchPane).mockReset().mockResolvedValue({ paneId: base.paneId, revision: 0, text: "screen", truncated: false });
  vi.mocked(sendKeys).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(sendReply).mockReset().mockResolvedValue({ ok: true });
  harness.blocks.mockReset();
});

describe("opt-in shared dialog recipes", () => {
  it("walks and verifies a checkbox, binding Space to the freshly pointed style", async () => {
    const multi = checkbox();
    const next = { ...multi, pointerRow: 2, regionSignature: "second", styledSignature: "second-style" };
    harness.blocks.mockReturnValueOnce([{ kind: "multi-select", multi }]).mockReturnValueOnce([{ kind: "multi-select", multi }])
      .mockReturnValue([{ kind: "multi-select", multi: next }]);
    expect(await submitMultiSelectIntent({ ...base, multi, intent: { kind: "toggle", n: 2 } })).toEqual({ status: "sent" });
    expect(vi.mocked(sendKeys).mock.calls).toEqual([
      [base.paneId, ["Down"], undefined, "first", "first-style"],
      [base.paneId, ["Space"], undefined, "second", "second-style"],
    ]);
  });

  it("walks a declared preview selection then binds its commit to fresh evidence", async () => {
    const preview = editorDialog();
    preview.options[0]!.pointed = false; preview.options[0]!.keys = ["Down", "Enter"];
    const moved = { ...preview, options: [{ ...preview.options[0]!, pointed: true, keys: ["Enter"] }], regionSignature: "pointed", styledSignature: "pointed-style" };
    harness.blocks.mockReturnValueOnce([{ kind: "preview-select", preview }]).mockReturnValue([{ kind: "preview-select", preview: moved }]);
    expect(await submitPreviewOption({ ...base, preview, option: preview.options[0]! })).toEqual({ status: "sent" });
    expect(vi.mocked(sendKeys).mock.calls.at(-1)).toEqual([base.paneId, ["Enter"], undefined, "pointed", "pointed-style"]);
  });

  it("refuses legacy typing/note routes when a complete native edit is required", async () => {
    const preview = editorDialog();
    const multi = { ...checkbox(), editors: preview.editors, field: { n: 3, text: "summary", checked: true, focused: false, pointer: "above" as const, lines: 1, textComplete: false as const } };
    expect(await submitMultiSelectIntent({ ...base, multi, intent: { kind: "type", text: "new" } })).toMatchObject({ status: "changed" });
    expect(await submitPreviewNote({ ...base, preview, text: "new" })).toEqual({ status: "changed" });
    expect(sendKeys).not.toHaveBeenCalled(); expect(sendReply).not.toHaveBeenCalled();
  });

  it("treats new policies, key plans and completeness as identity, not transient focus", () => {
    const preview = editorDialog();
    for (const changed of [
      { ...preview, cancelKeys: ["Tab"] },
      { ...preview, navigation: { back: ["Up"], next: ["Down"] } },
      { ...preview, field: { ...preview.field!, textComplete: undefined } },
      { ...preview, options: [{ ...preview.options[0]!, keys: ["Space"] }] },
    ]) { expect(previewCoreEqual(preview, changed)).toBe(false); expect(previewsEqual(preview, changed)).toBe(false); }
    const multi = checkbox();
    for (const changed of [{ ...multi, cancelKeys: ["Tab"] }, { ...multi, toggle: "pointer" as const }, { ...multi, navigation: { back: ["Up"], next: ["Down"] } }]) {
      expect(multiSelectIdentity(multi, changed)).toBe(false); expect(multiSelectEquals(multi, changed)).toBe(false);
    }
  });
});
