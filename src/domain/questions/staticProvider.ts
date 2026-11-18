import en from "./bank.en.json";
import id from "./bank.id.json";

export function questionFor(language: "id" | "en", turn: number, mode: "socratic" | "devil" = "socratic") {
  const bank = (language === "id" ? id : en)[mode];
  return bank[turn % bank.length];
}

export function controls(action: "explain" | "hint" | "skip" | "stop", hint: number) {
  if (action === "hint") return { mode: "test", hint: Math.min(3, hint + 1) } as const;
  return { mode: action === "explain" ? "teach" : "exit", hint: 0 } as const;
}
