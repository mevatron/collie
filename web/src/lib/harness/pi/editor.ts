import { lineText, type StyledLine } from "../../blocks";
import { canonicalStyledLines, encodeStyledRegion } from "../../styled-region";
import { cropRawColumns } from "../../column-range";
import { displayWidth } from "../../text-width";
import type { DialogEditorObservation, DialogEditors, EditorContext, EditorContextProjection, EditorReadPlan } from "../editor-model";
import type { PiFrame } from "./ask";

const READ_KEYS = { start: ["ctrl+a"], end: ["ctrl+e"], up: ["Up"], left: ["Left"], right: ["Right"] };
/** Pi-tui's inline Input paints a breakable space as NBSP; its appended end cell is NBSP too. */
export const PI_INLINE_READ: EditorReadPlan = {
  keys: READ_KEYS, endCell: "\u00a0", whitespaceCells: [" ", "\u00a0"], paintedSpace: "\u00a0",
};

/** RPIV 2.15.0 on Pi 1.4.0, English/default bindings. Declarations perform no pane I/O. */
export function piEditorPlans(ownerSignature: string, answer?: { focusKeys: string[]; commitKeys?: string[] }, context: EditorContext | null = null): DialogEditors {
  return {
    ownerSignature,
    answer: answer === undefined ? undefined : {
      ...answer, clearKeys: ["ctrl+u"], normalize: "preserve", unchangedExit: "preserve",
      return: { keys: ["ctrl+a", "Up"], repeat: "logical-lines" }, read: PI_INLINE_READ,
    },
    note: {
      openKeys: ["n"], clearLineKeys: ["ctrl+a", "ctrl+k", "Backspace"], closeKeys: ["Escape"],
      normalize: "trim", unchangedExit: "save", context,
      read: { keys: READ_KEYS, endCell: " ", whitespaceCells: [" "] },
    },
  };
}

/** Cut already-rendered cells without importing the panel's runtime question reader. */
function columns(line: StyledLine, start: number, end = Infinity): StyledLine {
  let offset = 0;
  return { segments: line.segments.map((span) => {
    const text = cropRawColumns(span.text, { start: Math.max(0, start - offset), end: Math.max(0, end - offset) });
    offset += displayWidth(span.text);
    return Object.assign({}, span, { text });
  }) };
}

/** Measured native note context: actual visible body rows and fixed heading/preview/chrome.
 * The originating reader declares only a complete sequence; later windows never invent rows. */
export function piNoteContext(
  lines: StyledLine[], frame: PiFrame, editor?: { label: number; end: number }, summaryEnd?: number,
): EditorContextProjection | null {
  const { texts, top, bodyEnd } = frame;
  if (bodyEnd === undefined || frame.open) return null;
  const footer = frame.rpivHints ?? frame.footer;
  const footerInk = lines[frame.footerStart]!.segments.find((span) => span.text.trim() !== "")?.fg;
  const overflow = (line: StyledLine) => /^[↑↓↕]$/.test(lineText(line).trimEnd()) && line.segments.every((span) =>
    span.text.trim() === "" || span.fg === footerInk && !span.bg && !span.bold && !span.dim && !span.italic && !span.underline && !span.strike);
  const review = texts.findIndex((text, row) => row > top && row < bodyEnd && text === " Review your answers" &&
    lines[row]!.segments.some((span) => span.bold));
  let first = review >= 0 ? review + 1 : top + 1;
  if (review < 0) while (first < bodyEnd && !/^[❯ ] [1-9]\. /.test(texts[first]!) && !overflow(lines[first]!)) first++;
  if (first >= bodyEnd && review < 0) return null;
  let end = editor?.label ?? summaryEnd ?? texts.findIndex((text, row) => row >= first && row < bodyEnd && text.startsWith(" Note for this answer: "));
  if (end < 0) end = bodyEnd;
  if (editor !== undefined && texts.slice(editor.end + 1, bodyEnd).some((text) => text !== "")) return null;
  const boxStart = texts.findIndex((text, row) => row >= first && row < end && /┌─{3,}┐$/.test(text));
  let optionLines = lines.slice(first, end);
  let preview: StyledLine[] = [];
  if (boxStart >= 0) {
    const column = displayWidth(texts[boxStart]!.slice(0, texts[boxStart]!.indexOf("┌")));
    const right = (row: number) => columns(lines[row]!, column);
    const boxEnd = texts.findIndex((_text, row) => row > boxStart && row < end && /^└─{3,}┘$/.test(lineText(right(row)).trimEnd()));
    if (boxEnd < 0 || lineText(right(boxStart)).trimEnd().slice(1, -1) !== lineText(right(boxEnd)).trimEnd().slice(1, -1) ||
        lines.slice(boxStart + 1, boxEnd).some((_line, index) => !/^│.*│$/.test(lineText(right(boxStart + 1 + index)).trimEnd()))) return null;
    preview = Array.from({ length: boxEnd - boxStart + 1 }, (_, index) => right(boxStart + index));
    if (column === 0) {
      optionLines = lines.slice(first, boxStart);
      if (lines.slice(boxEnd + 1, end).some((line) => lineText(line).trim() !== "" &&
          !/^(?:Notes: press n to add notes|Note saved: press n to edit)$/.test(lineText(line).trimEnd()))) return null;
    } else optionLines = optionLines.map((line) => columns(line, 0, column));
  }
  // Layout padding is not context, but internal blank rows in a review remain in the bound screen.
  while (optionLines.length > 0 && lineText(optionLines[0]!).trim() === "") optionLines.shift();
  while (optionLines.length > 0 && lineText(optionLines.at(-1)!).trim() === "") optionLines.pop();
  const clippedBefore = optionLines.length > 0 && overflow(optionLines[0]!) && /[↑↕]/.test(lineText(optionLines[0]!));
  const clippedAfter = optionLines.length > 0 && overflow(optionLines.at(-1)!) && /[↓↕]/.test(lineText(optionLines.at(-1)!));
  optionLines = optionLines.slice(Number(clippedBefore), optionLines.length - Number(clippedAfter));
  if (optionLines.some((line) => /^[↑↓↕]$/.test(lineText(line).trimEnd()))) return null;
  const accent = lines[top]!.segments.find((span) => span.fg !== undefined)?.fg;
  const normalizePointer = (line: StyledLine): StyledLine => !lineText(line).startsWith("❯ ") ? line : {
    segments: line.segments.map((span, index) => Object.assign({}, span, {
      text: index === 0 ? span.text.replace(/^❯/, " ") : span.text,
      fg: span.bold && span.fg === accent ? undefined : span.fg,
      bold: span.bold && span.fg === accent ? undefined : span.bold,
    })),
  };
  return {
    fixedSignature: JSON.stringify([canonicalStyledLines(lines.slice(top, first)), canonicalStyledLines(preview),
      canonicalStyledLines([lines[bodyEnd]!]), review >= 0 ? canonicalStyledLines(lines.slice(bodyEnd + 1, frame.footerStart).map(normalizePointer)) : [],
      [footer.arrowsMove, footer.enter, footer.spaceToggles, footer.escapeVerb, footer.tabs, footerInk]]),
    rows: canonicalStyledLines(optionLines.map(normalizePointer)), clippedBefore, clippedAfter,
  };
}

/** Default-Pi native inputs in the outside-footer questionnaire shape. Complete bounds and a real
 * reverse-video cell are required; displayed wraps never become logical newlines here. */
export function observePiEditor(lines: StyledLine[], frame: PiFrame | null, ownerSignature: string | null): DialogEditorObservation | null {
  if (frame?.bodyEnd === undefined || frame.open || !frame.footer.arrowsMove || frame.footer.enter !== "select") return null;
  if (ownerSignature === null) return null;
  const width = frame.texts[frame.top]!.length;
  const fullRule = (text: string) => text === "─".repeat(width);
  const note = frame.texts.findLastIndex((text, row) => row > frame.top && row < frame.bodyEnd! &&
    /^ (Notes|Global note):$/.test(text) && lines[row]!.segments.some((segment) => segment.fg !== undefined && segment.text.trim() !== ""));
  const layout = note >= 0 ? "boxed" : "inline";
  const purpose = layout === "boxed" ? (frame.texts[note]!.trim() === "Global note:" ? "global-note" : "question-note") : "answer";
  let start = -1;
  let end = -1;
  let indent = 0;
  if (layout === "boxed") {
    if (!fullRule(frame.texts[note + 1]!)) return null;
    start = note + 2;
    end = frame.texts.findIndex((text, row) => row > start && row < frame.bodyEnd! && fullRule(text));
    // The default Editor reserves a cursor column: a value row cannot be its full-width border.
    if (frame.texts.slice(start, end).some((text) => text.length === width && text.startsWith("─") && /[↑↓]/.test(text))) return null;
  } else {
    const prefix = frame.footer.spaceToggles ? /^([❯ ]) ([1-9]\d*)\. \[[ ✔✓x]\] / : /^([❯ ]) ([1-9]\d*)\. /;
    let focused = false;
    for (let row = frame.top + 1; row < frame.bodyEnd; row++) {
      const match = prefix.exec(lineText(lines[row]!));
      if (match !== null) { start = row; indent = match[0].length; focused = match[1] === "❯"; }
    }
    if (!focused) return null;
    if (frame.footer.spaceToggles) end = frame.texts.findIndex((text, row) => row > start && row < frame.bodyEnd! && /^  (Next|Submit)$/.test(text));
    else {
      // selectedText styles the continuation PREFIX too: even an empty logical row has bold
      // indent cells. The dialog's trailing spacer/padding is unpainted, so it is not input.
      end = start + 1;
      while (end < frame.bodyEnd && lineText(lines[end]!).slice(0, indent).trim() === "" &&
        lines[end]!.segments.some((segment) => segment.bold)) end++;
      if (frame.texts.slice(end, frame.bodyEnd).some((text) => text !== "" && !text.startsWith(" Note for this answer: "))) return null;
    }
  }
  if (start < 0 || end <= start) return null;
  const rows: string[] = [];
  let cursor: DialogEditorObservation["cursor"] | null = null;
  for (let row = start; row < end; row++) {
    const text = lineText(lines[row]!);
    if (layout === "inline" && row > start && text.slice(0, indent).trim() !== "") return null;
    let offset = 0;
    let ownedEnd = 0;
    for (const segment of lines[row]!.segments) {
      if (segment.bg !== undefined) {
        if (cursor !== null || offset < indent) return null;
        cursor = { row: row - start, offset: offset - indent, cell: segment.text };
      }
      offset += segment.text.length;
      if (segment.bold || segment.bg !== undefined) ownedEnd = offset;
    }
    rows.push(layout === "boxed" ? text.trimEnd() : text.slice(indent, ownedEnd));
  }
  if (cursor === null) return null;
  if (layout === "boxed") {
    const text = lineText(lines[start + cursor.row]!);
    rows[cursor.row] = text.slice(0, Math.max(text.trimEnd().length, cursor.offset + cursor.cell.length));
  }
  const region = lines.slice(frame.top, frame.bottom + 1);
  const fixedRows = [...lines.slice(frame.top, start), ...lines.slice(end, frame.bottom + 1)]
    .filter((line) => lineText(line).trim() !== ""); // layout padding can change with a cursor-only row
  const contextSignature = JSON.stringify([encodeStyledRegion(canonicalStyledLines(fixedRows)),
    // The custom checkbox tick follows this editor's own value, unlike authored choice ticks.
    layout === "inline" ? lineText(lines[start]!).slice(0, indent).replace(/\[[ ✔✓x]\]/, "[]") : ""]);
  return {
    purpose, layout, ownerSignature, contextSignature, rows, cursor,
    contextProjection: layout === "boxed" ? piNoteContext(lines, frame, { label: note, end }) ?? undefined : undefined,
    regionSignature: region.map((line) => lineText(line).trimEnd()).join("\n"),
    styledSignature: encodeStyledRegion(canonicalStyledLines(region)),
  };
}
