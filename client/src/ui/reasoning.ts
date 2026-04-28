import {
  renderThinkingLabel,
  renderThinkingText,
} from "./render.ts";
import { writeOutput } from "./terminal.ts";

export class ReasoningRenderer {
  private active = false;
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

    if (!this.active) {
      writeOutput(`\n${renderThinkingLabel()} `);
      this.active = true;
    }

    writeOutput(renderThinkingText(text));
    this.activity = true;
  }

  flush(): void {
    if (!this.active) {
      return;
    }
    writeOutput("\n\n");
    this.active = false;
  }
}
