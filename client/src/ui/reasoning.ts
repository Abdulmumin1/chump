import {
  renderThinkingBlock,
} from "./render.ts";
import { writeOutput } from "./terminal.ts";

export class ReasoningRenderer {
  private title: string | null = null;
  private buffer = "";
  private activity = false;

  consumeActivity(): boolean {
    const hadActivity = this.activity;
    this.activity = false;
    return hadActivity;
  }

  render(payload: Record<string, unknown>): void {
    const text = typeof payload.text === "string" ? payload.text : "";
    if (!text) {
      return;
    }

    if (payload.kind === "summary") {
      this.title = text.trim() || this.title;
    } else {
      this.buffer += text;
    }
    this.activity = true;
  }

  flush(): void {
    const content = this.buffer.trim();
    if (!this.title && !content) {
      return;
    }
    const block = renderThinkingBlock(this.title, this.buffer);
    writeOutput(`\n${block.join("\n")}\n\n`);
    this.title = null;
    this.buffer = "";
  }
}
