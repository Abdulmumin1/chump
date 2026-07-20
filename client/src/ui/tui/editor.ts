import {
  Editor,
  matchesKey,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";

import { logClientEvent } from "../../app/diagnostics.ts";
import type {
  ChatAttachment,
  ImageAttachment,
  PromptSubmission,
} from "../../core/types.ts";
import {
  readClipboardImageAttachment,
  readClipboardText,
  readImageAttachment,
} from "../attachments.ts";
import type { ChumpTuiKeyHandler } from "./extensions.ts";

const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";

export class ChumpEditor extends Editor {
  private attachments: ChatAttachment[] = [];
  private nextImageNumber = 1;
  private lastEscapeAt = 0;
  private submittedAttachments: ChatAttachment[] | null = null;
  private readonly keyHandlers: ChumpTuiKeyHandler[];

  onExit?: () => void;
  onAbort?: () => void;
  onEscapeHint?: (active: boolean) => void;
  onPopQueued?: () => PromptSubmission | null;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keyHandlers: ChumpTuiKeyHandler[],
  ) {
    super(tui, theme, { paddingX: 1, autocompleteMaxVisible: 6 });
    this.keyHandlers = keyHandlers;
    this.onChange = (value) => {
      if (this.submittedAttachments === null) {
        this.attachments = attachmentsForDraft(value, this.attachments);
      }
    };
  }

  takeSubmittedAttachments(): ChatAttachment[] {
    const attachments = this.submittedAttachments ?? this.attachments;
    this.submittedAttachments = null;
    this.attachments = [];
    this.nextImageNumber = 1;
    return [...attachments];
  }

  restoreFillCompletion(value: string): void {
    this.submittedAttachments = null;
    this.setText(`${value.trimEnd()} `);
  }

  openPicker(value: string): void {
    this.restoreFillCompletion(value);
    // Pi treats Tab as an explicit autocomplete request. Issuing it after
    // restoring the command makes Enter on an exact picker command reliably
    // open its options even when autocomplete loses a race with Enter.
    super.handleInput("\t");
  }

  restoreSubmission(submission: PromptSubmission): void {
    this.attachments = [...submission.attachments];
    this.nextImageNumber =
      submission.attachments.filter((attachment) => attachment.type === "image")
        .length + 1;
    this.setText(formatSubmissionPreview(submission));
  }

  override handleInput(data: string): void {
    for (const handler of this.keyHandlers) {
      if (handler(data) === true) {
        return;
      }
    }

    if (matchesKey(data, "ctrl+c")) {
      this.onExit?.();
      return;
    }

    if (matchesKey(data, "ctrl+d") && this.getText().length === 0) {
      this.onExit?.();
      return;
    }

    if (matchesKey(data, "escape") && !this.isShowingAutocomplete()) {
      const now = Date.now();
      if (this.onAbort && now - this.lastEscapeAt <= 600) {
        this.lastEscapeAt = 0;
        this.onEscapeHint?.(false);
        logClientEvent("abortShortcut", "double escape");
        this.onAbort();
        return;
      }
      this.lastEscapeAt = now;
      this.onEscapeHint?.(Boolean(this.onAbort));
      return;
    }

    this.lastEscapeAt = 0;
    this.onEscapeHint?.(false);

    if (isPopQueuedInput(data) && this.getText().length === 0) {
      const queued = this.onPopQueued?.();
      if (queued) {
        this.restoreSubmission(queued);
      }
      return;
    }

    if (matchesKey(data, "ctrl+v")) {
      void this.insertClipboard();
      return;
    }

    const pasted = readBracketedPaste(data);
    if (pasted !== null) {
      void this.insertPaste(pasted);
      return;
    }

    const maySubmit = matchesKey(data, "enter");
    if (maySubmit) {
      this.submittedAttachments = [...this.attachments];
    }
    super.handleInput(data);
    if (maySubmit && this.getText().length > 0) {
      this.submittedAttachments = null;
    }
  }

  private async insertPaste(value: string): Promise<void> {
    const image = await readImageAttachment(value, process.cwd()).catch(() => null);
    if (image) {
      this.insertImageAttachment(image);
      return;
    }
    super.handleInput(`${BRACKETED_PASTE_START}${value}${BRACKETED_PASTE_END}`);
    this.tui.requestRender();
  }

  private async insertClipboard(): Promise<void> {
    const image = await readClipboardImageAttachment().catch(() => null);
    if (image) {
      logClientEvent(
        "clipboardImage",
        `${image.mime} bytes=${Buffer.byteLength(image.data, "base64")}`,
      );
      this.insertImageAttachment(image);
      return;
    }

    const text = await readClipboardText().catch(() => null);
    if (text) {
      logClientEvent("clipboardText", `chars=${text.length}`);
      await this.insertPaste(text);
      return;
    }
    logClientEvent("clipboard", "empty");
  }

  private insertImageAttachment(image: ImageAttachment): void {
    const label = `[Image ${this.nextImageNumber++}: ${image.filename}]`;
    this.attachments.push({ ...image, label });
    this.insertTextAtCursor(`${label} `);
    this.tui.requestRender();
  }
}

export function attachmentsForDraft(
  value: string,
  attachments: ChatAttachment[],
): ChatAttachment[] {
  return attachments.filter((attachment) => value.includes(attachment.label));
}

function readBracketedPaste(data: string): string | null {
  if (!data.startsWith(BRACKETED_PASTE_START) || !data.endsWith(BRACKETED_PASTE_END)) {
    return null;
  }
  return data.slice(BRACKETED_PASTE_START.length, -BRACKETED_PASTE_END.length);
}

function isPopQueuedInput(data: string): boolean {
  return matchesKey(data, "alt+up") || [
    "\x1b[1;2A",
    "\x1b[1;3A",
    "\x1b[1;4A",
    "\x1b[1;5A",
    "\x1b[1;6A",
    "\x1b[1;7A",
    "\x1b[1;8A",
    "\x1b[1;9A",
  ].includes(data);
}

function formatSubmissionPreview(submission: PromptSubmission): string {
  let text = submission.text;
  for (const attachment of submission.attachments) {
    if (attachment.type === "text") {
      text = text.replace(attachment.text, attachment.label);
    }
    if (attachment.type === "image" && !text.includes(attachment.label)) {
      text = `${text.trimEnd()} ${attachment.label}`.trim();
    }
  }
  return text;
}
