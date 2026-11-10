import { existsSync, readFileSync } from "node:fs";
import { beforeAll, expect, test } from "vitest";
import { Rig } from "./leg";
import { editorApi } from "./editor-api";
import { parseAnsi } from "../../src/lib/ansi";
import { splitLines } from "../../src/lib/blocks";
import { asJsonNumber, asJsonObject, asJsonString, parseJson } from "../../src/lib/json";
import { piAdapter } from "../../src/lib/harness/pi";
import { cancelDialogEditor, prepareDialogEditor, saveDialogEditor } from "../../src/lib/editor-action";
import type { DialogTarget } from "../../src/lib/dialog-guard";
import { submitMultiSelectIntent } from "../../src/lib/multi-select-action";

const rig = new Rig();
const pane = process.env.COLLIE_REVIEW_PANE ?? "";
if (!pane) throw new Error("set COLLIE_REVIEW_PANE to a fresh disposable fixture pane id");
const resultFile = process.env.COLLIE_REVIEW_RESULT ?? "";
if (!resultFile) throw new Error("set COLLIE_REVIEW_RESULT to the fixture's fresh native tool-result JSON path");
const globalNote = "Global from phone\nSecond global line";
const endpoint = `/api/pane/${encodeURIComponent(pane)}`;
const throughApi = editorApi(rig);
async function target(): Promise<DialogTarget<"multi-select">> {
  const doc = asJsonObject(await rig.get(`${endpoint}?lines=80`));
  const raw = asJsonString(doc?.text), revision = asJsonNumber(doc?.revision);
  if (raw === undefined || revision === undefined) throw new Error("fixture pane returned no text/revision");
  const block = piAdapter.buildBlocks(splitLines(parseAnsi(raw))).find((candidate) => candidate.kind === "multi-select");
  if (block?.multi.phase !== "review") throw new Error("fixture has no complete native review");
  return { paneId: pane, requestedLines: 80, detectedRevision: revision, agent: "pi", kind: "multi-select", model: block.multi };
}
beforeAll(async () => {
  expect(existsSync(resultFile), "use a fresh result path, not a previous native outcome").toBe(false);
  const ready = await rig.until(() => target(), () => true, 20_000, 100);
  if (ready === null) throw new Error("put the isolated review fixture on Submit first");
});

test("reads, saves and returns from a global note without submitting or filling missing answers", async () => {
  const origin = await target();
  const prepared = await throughApi("prepare", () => prepareDialogEditor(origin, "global-note"));
  expect(prepared.status, JSON.stringify(prepared)).toBe("ready");
  if (prepared.status !== "ready") return;
  try {
    const text = globalNote;
    expect(await throughApi("save", () => saveDialogEditor(prepared.seen, text))).toEqual({ status: "sent" });
    const after = await target();
    expect(after.model.phase).toBe("review");
    if (after.model.phase !== "review" || origin.model.phase !== "review") return;
    expect(after.model.incomplete).toBe(origin.model.incomplete);
    expect(after.model.answers).toEqual(origin.model.answers);
    if (after.model.note === undefined) expect(after.model.summaryClipped).toBe(true);
    else expect(after.model.note).toMatchObject({ state: "attached", textComplete: false });
    const read = await throughApi("prepare", () => prepareDialogEditor(after, "global-note"));
    expect(read.status, JSON.stringify(read)).toBe("ready");
    if (read.status === "ready") {
      expect(read.seen.text).toBe(text);
      expect(await throughApi("cancel", () => cancelDialogEditor(read.seen))).toEqual({ status: "sent" });
    }
  } finally {
    const editor = piAdapter.observeDialogEditor?.(splitLines(parseAnsi(await rig.rawScreen(pane))));
    if (editor?.purpose === "global-note") await rig.keys(pane, ["Escape"]);
  }
}, 50_000);

test("refuses a review commit if a visible note or answer changes after the entry guard", async () => {
  const origin = await target();
  const needle = origin.model.note?.text.split("\n")[0] ?? (origin.model.phase === "review" ? origin.model.answers?.[0]?.answer.split("\n")[0] : undefined);
  if (needle === undefined || needle === "") throw new Error("fixture has no visible review text to fault");
  let reads = 0;
  const result = await throughApi("read", () => submitMultiSelectIntent({
    paneId: pane, requestedLines: 80, detectedRevision: origin.detectedRevision, agent: "pi",
    multi: origin.model, intent: { kind: "confirm" }, sleep: async () => undefined,
  }), { transformRead(raw) {
    reads++;
    return reads === 1 ? raw : raw.replace(needle, "Changed from desk");
  } });
  expect(reads).toBeGreaterThanOrEqual(2);
  expect(result.status).toBe("changed");
  const after = (await target()).model;
  expect(after.note).toEqual(origin.model.note);
  if (after.phase === "review" && origin.model.phase === "review") expect(after.answers).toEqual(origin.model.answers);
});

// Submits the disposable questionnaire; keep this after the noncommitting review cases.
test("explicitly submits a partial review without answering its three missing questions", async () => {
  // Synthetic setup: answer only Plan, leaving Checks, Delivery and Optional untouched.
  await rig.keys(pane, ["Tab"]);
  const question = await rig.until(async () =>
    piAdapter.buildBlocks(splitLines(parseAnsi(await rig.rawScreen(pane))))
      .find((block) => block.kind === "preview-select"),
  (block) => block?.preview.options[0]?.pointed === true, 10_000, 100);
  expect(question?.preview.options[0]?.label).toBe("Sequential");
  await rig.keys(pane, ["Enter"]);
  expect(await rig.screenUntil(pane, /Which checks should the Collie probe run\?/, 10_000)).not.toBeNull();
  await rig.keys(pane, ["Tab", "Tab", "Tab"]);
  const origin = await rig.until(() => target(), () => true, 10_000, 100);
  expect(origin?.model).toMatchObject({ phase: "review", incomplete: true });
  if (origin === null) throw new Error("fixture did not reach its partial review");

  expect(await throughApi("commit", () => submitMultiSelectIntent({
    paneId: pane, requestedLines: 80, detectedRevision: origin.detectedRevision, agent: "pi",
    multi: origin.model, intent: { kind: "confirm" },
  }))).toEqual({ status: "sent" });

  const native = await rig.until(async () => parseJson(readFileSync(resultFile, "utf8")),
    (value) => Array.isArray(value), 10_000, 100);
  expect(native).toEqual([expect.objectContaining({ details: {
    answers: [{ questionIndex: 0, question: "Which implementation should the Collie probe use?",
      kind: "option", answer: "Sequential", preview: "Plan A\nRead -> Write\nKeep ordering" }],
    cancelled: false, globalNote, unanswered: [1, 2, 3],
  } })]);
}, 30_000);
