export const calloutTypes = ["teach", "probe", "feedback", "evidence", "misconception", "card", "review"] as const;
export type CalloutType = typeof calloutTypes[number];
export interface Callout { type: CalloutType; title: string; body: string; start: number; end: number }

export function callout(type: CalloutType, title: string, body: string): string {
  return "> [!cl-" + type + "] " + title.replace(/[\r\n]+/g, " ") + "\n" +
    quoteText(body);
}

export function quoteText(text: string): string {
  return text.split(/\r?\n/).map(line =>
    "> " + line.replace(/^([ \t]*)(?=\[!cl-)/i, "$1\\")).join("\n");
}

export function parseCallouts(body: string): Callout[] {
  const found: Callout[] = [];
  let fence = "";
  let current: Callout | undefined;
  let offset = 0;
  let hasBody = false;
  for (const chunk of body.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const line = chunk.replace(/\r?\n$/, "");
    const marker = /^ {0,3}(~~~+|\x60{3,})(.*)$/.exec(line);
    if (marker && !current) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = "";
    }
    const heading = !fence && /^> ?\[!cl-(teach|probe|feedback|evidence|misconception|card|review)\][+-]?[ \t]*(.*)$/.exec(line);
    if (heading) {
      current = { type: heading[1] as CalloutType, title: heading[2], body: "", start: offset, end: offset + line.length };
      found.push(current);
      hasBody = false;
    } else if (current && /^>/.test(line)) {
      current.body += (hasBody ? "\n" : "") + line.replace(/^> ?/, "");
      hasBody = true;
      current.end = offset + line.length;
    } else {
      current = undefined;
    }
    offset += chunk.length;
  }
  return found;
}

export function appendCallouts(body: string, ...blocks: string[]): string {
  if (blocks.length === 0) return body;
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const separator = body.endsWith(eol + eol) ? "" : body.endsWith(eol) ? eol : eol + eol;
  return body + (body ? separator : "") + blocks.join("\n\n").replace(/\n/g, eol) + eol;
}
