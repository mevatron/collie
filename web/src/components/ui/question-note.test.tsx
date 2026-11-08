import { act, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuestionNote } from "./question-note";

const summary = { state: "attached", text: "First line …", textComplete: false } as const;

describe("QuestionNote editing ownership", () => {
  it("delegates native editing without seeding a local editor from the summary", async () => {
    const user = userEvent.setup();
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => { complete = resolve; });
    const onRead = vi.fn(() => pending);
    const { container } = render(<QuestionNote note={summary} saving={false} maxLength={300} onRead={onRead} onSave={vi.fn()} />);
    const view = within(container);
    await user.click(view.getByRole("button", { name: "Edit note" }));
    expect(onRead).toHaveBeenCalledWith(false);
    expect(view.queryByRole("textbox")).not.toBeInTheDocument();
    await act(async () => complete());
    expect(view.queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(view.getByRole("button", { name: "Remove note" }));
    expect(onRead).toHaveBeenLastCalledWith(true);
  });

  it("retains legacy local editing and an unacknowledged draft", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => false);
    const { container } = render(<QuestionNote note={{ state: "attached", text: "Existing note" }} saving={false} maxLength={300} onSave={onSave} />);
    const view = within(container);
    await user.click(view.getByRole("button", { name: "Edit note" }));
    const field = await view.findByRole("textbox", { name: "Note text" });
    expect(field).toHaveValue("Existing note");
    await user.clear(field);
    await user.type(field, "Phone draft");
    await user.click(view.getByRole("button", { name: "Save note" }));
    expect(onSave).toHaveBeenCalledWith("Phone draft");
    expect(field).toHaveValue("Phone draft");
  });

  it("locks replacement and removal from an incomplete summary without a reader", () => {
    const { container } = render(<QuestionNote note={summary} saving={false} maxLength={300} onSave={vi.fn()} />);
    const view = within(container);
    expect(view.getByRole("button", { name: "Edit note" })).toBeDisabled();
    expect(view.getByRole("button", { name: "Remove note" })).toBeDisabled();
  });
});
