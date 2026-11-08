import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DialogEditorObservation } from "./harness/editor-model";
import { editorDialog, editorKeys } from "@/test/dialog-editor";

vi.mock("./api", () => ({ fetchPane: vi.fn(), sendKeys: vi.fn(), sendReply: vi.fn() }));
const harness = vi.hoisted(() => ({ observe: vi.fn(), blocks: vi.fn() }));
vi.mock("./harness/registry", () => ({
  adapterFor: () => ({ observeDialogEditor: harness.observe, buildBlocks: harness.blocks }),
}));
import { fetchPane, sendKeys, sendReply } from "./api";
import { cancelDialogEditor, prepareDialogEditor, readDialogEditor, saveDialogEditor, type SeenValue } from "./editor-action";

// A synthetic observer/input boundary: logical lines only, no terminal parser or RPIV captures.
function nativeEditor(text: string, purpose: DialogEditorObservation["purpose"] = "answer", marker = " ") {
  const dialog = editorDialog();
  let editing = true, row = 0, offset = 0;
  const state = { text, context: "context", dialog, dropReturn: false, wrongReplacement: false };
  const lines = () => state.text.split("\n");
  const plan = purpose === "answer" ? dialog.editors!.answer! : dialog.editors!.note!;
  plan.read.endCell = marker;
  harness.observe.mockImplementation(() => {
    if (!editing) return null;
    const rows = lines().map((line, index) => index === row && offset === line.length ? line + plan.read.endCell : line);
    return { ...observation(), purpose, contextSignature: state.context, rows,
      cursor: { row, offset, cell: offset === lines()[row]!.length ? plan.read.endCell : rows[row]!.slice(offset, offset + 1) },
      regionSignature: `editor:${state.text}`, styledSignature: `cursor:${row}:${offset}` };
  });
  harness.blocks.mockImplementation(() => [{ kind: "preview-select", lines: [], preview: {
    ...state.dialog,
    field: { ...state.dialog.field!, text: purpose === "answer" ? state.text : state.dialog.field!.text, focused: purpose === "answer" && editing },
    note: purpose === "answer" ? state.dialog.note : { state: editing ? "editing" : "attached", text: state.text },
  } }]);
  vi.mocked(sendKeys).mockImplementation(async (_pane, keys) => {
    for (const key of keys) {
      if (key === "Home") offset = 0;
      else if (key === "End") offset = lines()[row]!.length;
      else if (key === "Up") {
        if (row > 0) { row--; offset = Math.min(offset, lines()[row]!.length); }
        else if (!state.dropReturn) editing = false;
      } else if (key === "Right") {
        if (offset < lines()[row]!.length) offset++;
        else if (row + 1 < lines().length) { row++; offset = 0; }
      } else if (key === "Left") offset = Math.max(0, offset - 1);
      else if (key === "ctrl+u") { state.text = ""; row = 0; offset = 0; }
      else if (key === "Escape" && !state.dropReturn) {
        editing = false;
        if (plan.unchangedExit === "save" && plan.normalize === "trim") state.text = state.text.trim();
      } else if (key === "n" || key === "Down") editing = true;
    }
    return { ok: true };
  });
  vi.mocked(sendReply).mockImplementation(async (_pane, value) => {
    state.text = state.wrongReplacement ? "unexpected" : value;
    row = lines().length - 1; offset = lines()[row]!.length;
    return { ok: true };
  });
  const model = harness.blocks()[0].preview;
  const seen: SeenValue = { text, purpose, contextSignature: state.context,
    origin: { ...base, kind: "preview-select", model, detectedRevision: 0 } };
  return { state, seen };
}

const base = { paneId: "w1:p1", requestedLines: 80, agent: "synthetic", sleep: async () => {} };
function observation(): DialogEditorObservation {
  return { purpose: "answer", layout: "inline", ownerSignature: "question-1", contextSignature: "context",
    regionSignature: "editor", styledSignature: "style", rows: ["hello"],
    cursor: { row: 0, offset: 0, cell: "h" } };
}
beforeEach(() => {
  vi.mocked(fetchPane).mockReset().mockResolvedValue({ paneId: base.paneId, revision: 0, text: "screen", truncated: false });
  vi.mocked(sendKeys).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(sendReply).mockReset().mockResolvedValue({ ok: true });
  harness.observe.mockReset().mockReturnValue(observation());
  harness.blocks.mockReset().mockReturnValue([{ kind: "preview-select", preview: editorDialog(), lines: [] }]);
});

describe("declared native editor reads", () => {
  it.each(["_", "e\u0301"])("reads and saves using the declared %j end marker", async (marker) => {
    const { seen, state } = nativeEditor("original", "answer", marker);
    expect(await saveDialogEditor(seen, "replacement")).toEqual({ status: "sent" });
    expect(state.text).toBe("replacement");
    expect(vi.mocked(sendKeys).mock.calls.at(-1)?.[1]).toEqual(["Enter"]);
  });
  it("uses the originating cursor-key policy instead of adopting fresh observed keys", async () => {
    const { seen } = nativeEditor("original");
    const observe = harness.observe.getMockImplementation()!;
    harness.observe.mockImplementation(() => Object.assign(observe(), { keys: { ...editorKeys, start: ["ctrl+u"] } }));
    await readDialogEditor({ ...base, ownerSignature: "question-1", purpose: "answer", readPlan: seen.origin.model.editors!.answer!.read });
    expect(vi.mocked(sendKeys).mock.calls[0]?.[1]).toEqual(["Home"]);
  });
  it("refuses absent/incomplete capabilities and direct reads with no policy before any key", async () => {
    const model = editorDialog();
    model.editors = undefined;
    expect(await prepareDialogEditor({ ...base, kind: "preview-select", model, detectedRevision: 0 }, "answer")).toEqual({ status: "changed" });
    model.editors = editorDialog().editors;
    Object.assign(model.editors!.answer!, { read: undefined });
    expect(await prepareDialogEditor({ ...base, kind: "preview-select", model, detectedRevision: 0 }, "answer")).toEqual({ status: "changed" });
    expect(await readDialogEditor({ ...base, ownerSignature: "question-1", purpose: "answer" })).toMatchObject({ status: "changed" });
    expect(sendKeys).not.toHaveBeenCalled();
    expect(sendReply).not.toHaveBeenCalled();
  });

  it("threads the originating read plan through preparation", async () => {
    const { seen } = nativeEditor("complete");
    const prepared = await prepareDialogEditor(seen.origin, "answer");
    expect(prepared).toMatchObject({ status: "ready", seen: { text: "complete" } });
  });

  it("preserves multiline answer whitespace and returns once per logical line", async () => {
    const { seen } = nativeEditor("  first\nsecond  ");
    expect(await cancelDialogEditor(seen)).toEqual({ status: "sent" });
    expect(vi.mocked(sendKeys).mock.calls.at(-1)?.[1]).toEqual(["Home", "Up", "Home", "Up"]);
    expect(sendReply).not.toHaveBeenCalled();
  });

  it("supports a once-only declared return and requires acknowledgement", async () => {
    const { seen, state } = nativeEditor("original");
    seen.origin.model.editors!.answer!.return = { keys: ["Escape"], repeat: "once" };
    state.dropReturn = true;
    expect(await cancelDialogEditor(seen)).toMatchObject({ status: "changed" });
    expect(vi.mocked(sendKeys).mock.calls.at(-1)?.[1]).toEqual(["Escape"]);
  });

  it.each(["owner", "context", "value", "plan"])("refuses a changed %s before erasing", async (change) => {
    const { seen, state } = nativeEditor("original");
    if (change === "context") state.context = "successor";
    if (change === "value") state.text = "desk edit";
    if (change === "owner" || change === "plan") {
      state.dialog.editors = structuredClone(state.dialog.editors);
      if (change === "owner") state.dialog.editors!.ownerSignature = "successor";
      else state.dialog.editors!.answer!.normalize = "trim";
    }
    expect(await saveDialogEditor(seen, "replacement")).toMatchObject({ status: "changed" });
    expect(vi.mocked(sendKeys).mock.calls.flatMap((call) => call[1])).not.toContain("ctrl+u");
    expect(sendReply).not.toHaveBeenCalled();
  });

  it("sanitizes without flattening answers, binds writes, and reads the replacement exactly", async () => {
    const { seen, state } = nativeEditor("original");
    expect(await saveDialogEditor(seen, "  next\r\nline\u0007  ")).toEqual({ status: "sent" });
    expect(state.text).toBe("  next\nline  ");
    expect(sendReply).toHaveBeenCalledWith(base.paneId, "  next\nline  ", false, undefined, "editor:", "cursor:0:0");
    expect(vi.mocked(sendKeys).mock.calls.at(-1)?.[1]).toEqual(["Enter"]);
  });

  it("refuses mismatched replacement readback without committing or retrying", async () => {
    const { seen, state } = nativeEditor("original");
    state.wrongReplacement = true;
    expect(await saveDialogEditor(seen, "replacement")).toMatchObject({ status: "changed" });
    expect(sendReply).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendKeys).mock.calls.flatMap((call) => call[1])).not.toContain("Enter");
  });
  it("saves a note using declared normalization for both replacement and saving reopen", async () => {
    const { seen, state } = nativeEditor("  original  ", "question-note");
    expect(await saveDialogEditor(seen, "  replacement\r\nline\u001b  ")).toEqual({ status: "sent" });
    expect(state.text).toBe("replacement\nline");
    expect(sendReply).toHaveBeenCalledWith(base.paneId, "replacement\nline", false, undefined, "editor:", "cursor:0:0");
  });
  it.each([" ", "\u00a0"])("proves wrapped graphemes and preserves literal %j whitespace", async (space) => {
    const first = { ...observation(), rows: ["👩‍💻", `${space}b`], cursor: { row: 0, offset: 0, cell: "👩‍💻" } };
    const end = { ...first, rows: ["👩‍💻", `${space}b_`], cursor: { row: 1, offset: 2, cell: "_" } };
    const gap = { ...first, rows: ["👩‍💻", `${space === " " ? "~" : space}b`], cursor: { row: 1, offset: 0, cell: space === " " ? "~" : space } };
    const rest = { ...first, cursor: { row: 1, offset: 1, cell: "b" } };
    harness.observe.mockReturnValueOnce(first).mockReturnValueOnce(first).mockReturnValueOnce(end)
      .mockReturnValueOnce(gap).mockReturnValueOnce(rest).mockReturnValue(end);
    const result = await readDialogEditor({ ...base, ownerSignature: "question-1", purpose: "answer",
      readPlan: { endCell: "_", whitespaceCells: ["~", "\u00a0"], paintedSpace: "~", keys: editorKeys } });
    expect(result).toMatchObject({ status: "read", text: `👩‍💻${space}b` });
    // One grapheme, not its five UTF-16 code units, reaches the wrap boundary.
    expect(vi.mocked(sendKeys).mock.calls[2]?.[1]).toEqual(["Home", "Right"]);
  });

  it("refuses a changed context during a cursor-only read, and a clipped initial view", async () => {
    const first = observation();
    harness.observe.mockReturnValueOnce(first).mockReturnValue({ ...first, contextSignature: "successor" });
    expect(await readDialogEditor({ ...base, ownerSignature: "question-1", purpose: "answer", readPlan: editorDialog().editors!.answer!.read })).toMatchObject({ status: "changed" });
    expect(vi.mocked(sendKeys).mock.calls.map((call) => call[1])).toEqual([["Home"]]);
    vi.mocked(sendKeys).mockClear();
    harness.observe.mockReturnValue(null);
    expect(await readDialogEditor({ ...base, ownerSignature: "question-1", purpose: "answer", readPlan: editorDialog().editors!.answer!.read })).toMatchObject({ status: "changed" });
    expect(sendKeys).not.toHaveBeenCalled();
  });

  it("keeps note whitespace when the adapter declares a preserving exit", async () => {
    const { seen, state } = nativeEditor("  original  ", "question-note");
    const plan = seen.origin.model.editors!.note!;
    plan.normalize = "preserve"; plan.unchangedExit = "preserve";
    expect(await saveDialogEditor(seen, "  replacement  ")).toEqual({ status: "sent" });
    expect(state.text).toBe("  replacement  ");
  });

  it("uses the originating end-cell policy rather than inferring it from layout", async () => {
    const first = observation(), end = { ...first, rows: ["hello_"], cursor: { row: 0, offset: 5, cell: "_" } };
    harness.observe.mockReturnValueOnce(first).mockReturnValueOnce(first).mockReturnValue(end);
    const read = await readDialogEditor({ ...base, ownerSignature: "question-1", purpose: "answer",
      readPlan: editorDialog().editors!.answer!.read });
    expect(read).toEqual({ status: "read", text: "hello", observation: end });
    expect(sendReply).not.toHaveBeenCalled();
    expect(vi.mocked(sendKeys).mock.calls.map((call) => call[1])).toEqual([["Home"], ["End"]]);
  });
});
