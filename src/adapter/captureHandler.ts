import { captureMarkdown } from "../domain/captureMarkdown";
import { uniqueBase, validateCapture, type Capture } from "../domain/captureValidator";
import { localDate } from "../domain/dates";
import type { PropNames } from "../domain/learningProperties";

interface CaptureTarget<T> {
  folder(): Promise<string>;
  exists(path: string): boolean;
  create(path: string, content: string): Promise<T>;
}

export class CaptureHandler<T> {
  private readonly pending = new Set<string>();

  constructor(private readonly target: CaptureTarget<T>, private readonly recent: () => string[],
    private readonly remember: (ids: string[]) => void, private readonly names: () => PropNames,
    private readonly uuid: () => string) {}

  canOpen(id: string): boolean {
    return !this.recent().includes(id) && !this.pending.has(id);
  }

  async save(input: Capture) {
    const capture = validateCapture({ ...input, confidence: String(input.confidence) });
    if (!capture || !this.canOpen(capture.capture_id)) throw new Error("Invalid or duplicate capture");
    this.pending.add(capture.capture_id);
    try {
      const folder = await this.target.folder();
      const path = folder + "/" + uniqueBase(capture.title, capture.capture_id) + ".md";
      if (this.target.exists(path)) throw new Error("Capture already exists");
      const file = await this.target.create(path, captureMarkdown(capture, localDate(), this.uuid(), this.names()));
      this.remember([capture.capture_id, ...this.recent()].slice(0, 200));
      return file;
    } finally { this.pending.delete(capture.capture_id); }
  }
}
