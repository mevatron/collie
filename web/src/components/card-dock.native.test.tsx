import { act, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CardDock } from "./card-dock";
import type { SeenValue } from "@/lib/editor-action";
import type { Block } from "@/lib/blocks";
import { editorDialog } from "@/test/dialog-editor";
import { markAllDead, markLive } from "@/lib/liveness";

function editFixture(purpose: SeenValue["purpose"] = "question-note") {
  const model = editorDialog();
  model.field!.text = "";
  const blocks: Block[] = [{ kind: "preview-select", preview: model, lines: [] }];
  const seen: SeenValue = { text: "Complete first\nComplete second", purpose, contextSignature: "context",
    origin: { kind: "preview-select", model, paneId: "w1:p1", requestedLines: 80, detectedRevision: 0, agent: "synthetic" } };
  return { blocks, seen };
}

describe("CardDock temporary native drafts", () => {
  it("keeps a complete note and refused draft across polls and raw/editor views", async () => {
    const user = userEvent.setup();
    const { blocks, seen } = editFixture();
    const callbacks = { onPreviewAction: vi.fn(), onReadEditor: vi.fn(async () => seen),
      onSaveEditor: vi.fn(async () => false), onCancelEditor: vi.fn(async () => false) };
    const { container, rerender } = render(<CardDock blocks={blocks} {...callbacks} />);
    const view = within(container);
    await user.click(view.getByRole("button", { name: "Edit note" }));
    const field = await view.findByRole("textbox", { name: "Note text" });
    expect(field).toHaveValue(seen.text);
    await user.clear(field);
    await user.type(field, "Phone draft");
    rerender(<CardDock blocks={[]} {...callbacks} />);
    await user.click(view.getByRole("button", { name: "Save note" }));
    expect(callbacks.onSaveEditor).toHaveBeenCalledWith("Phone draft", seen);
    rerender(<CardDock blocks={[...blocks]} {...callbacks} />);
    expect(view.getByRole("textbox")).toBe(field);
    expect(field).toHaveValue("Phone draft");
    await user.click(view.getByRole("button", { name: "Back to the options" }));
    expect(callbacks.onCancelEditor).toHaveBeenCalledWith(seen);
    expect(field).toHaveValue("Phone draft");
  });

  it("shows the complete value before removal and closes only on acknowledged Return", async () => {
    const user = userEvent.setup();
    const { blocks, seen } = editFixture();
    const save = vi.fn(async () => false), back = vi.fn(async () => true);
    const { container } = render(<CardDock blocks={blocks} onPreviewAction={vi.fn()} onReadEditor={async () => seen} onSaveEditor={save} onCancelEditor={back} />);
    const view = within(container);
    await user.click(view.getByRole("button", { name: "Remove note" }));
    const field = await view.findByRole("textbox", { name: "Note text" });
    expect(field).toHaveValue(seen.text);
    expect(field).toHaveAttribute("readonly");
    expect(save).not.toHaveBeenCalled();
    await user.click(view.getByRole("button", { name: "Remove note" }));
    expect(save).toHaveBeenCalledWith("", seen);
    await user.click(view.getByRole("button", { name: "Back to the options" }));
    expect(back).toHaveBeenCalledWith(seen);
    expect(view.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it.each(["read-only", "stale", "offline"])("retains but locks a draft when %s", async (condition) => {
    const user = userEvent.setup();
    const { blocks, seen } = editFixture("answer");
    markLive("w1:p1");
    const callbacks = { onPreviewAction: vi.fn(), onReadEditor: vi.fn(async () => seen), onSaveEditor: vi.fn(async () => true) };
    const { container, rerender } = render(<CardDock blocks={blocks} paneId="w1:p1" {...callbacks} />);
    const view = within(container);
    await user.click(view.getByRole("button", { name: "Type your own answer" }));
    const field = await view.findByRole("textbox", { name: "Answer text" });
    if (condition === "offline") act(() => markAllDead());
    rerender(<CardDock blocks={[]} paneId="w1:p1" promptDisabled={condition === "read-only"} stale={condition === "stale"} {...callbacks} />);
    expect(field).toBeDisabled();
    expect(field).toHaveValue(seen.text);
    await user.click(view.getByRole("button", { name: "Send answer" }));
    expect(callbacks.onSaveEditor).not.toHaveBeenCalled();
  });

  it("discards scope/owner changes and ignores an old pane's pending read", async () => {
    const user = userEvent.setup();
    const { blocks, seen } = editFixture();
    let complete!: (value: SeenValue) => void;
    const pending = new Promise<SeenValue>((resolve) => { complete = resolve; });
    const callbacks = { onPreviewAction: vi.fn(), onReadEditor: vi.fn(() => pending), onSaveEditor: vi.fn(async () => true) };
    markLive("w1:p1"); markLive("w2:p1");
    const { container, rerender } = render(<CardDock blocks={blocks} paneId="w1:p1" {...callbacks} />);
    const view = within(container);
    await user.click(view.getByRole("button", { name: "Edit note" }));
    rerender(<CardDock blocks={blocks} paneId="w2:p1" {...callbacks} />);
    await act(async () => complete(seen));
    expect(view.queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(view.getByRole("button", { name: "Edit note" }));
    await view.findByRole("textbox");
    const successor = editorDialog(); successor.editors!.ownerSignature = "next-question";
    rerender(<CardDock blocks={[{ kind: "preview-select", preview: successor, lines: [] }]} paneId="w2:p1" {...callbacks} />);
    expect(view.queryByRole("textbox")).not.toBeInTheDocument();
    expect(callbacks.onSaveEditor).not.toHaveBeenCalled();
  });
});
