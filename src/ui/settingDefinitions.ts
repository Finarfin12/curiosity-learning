import type { Setting } from "obsidian";

export interface SettingItemDef {
  id: string;
  name: string;
  desc?: string;
  cls?: string;
  searchable?: boolean;
  keywords?: string[];
  visible?: boolean | (() => boolean);
  render: (setting: Setting) => void;
}

export interface SettingGroupDef {
  type: "group";
  id: string;
  heading?: string;
  cls?: string;
  visible?: boolean | (() => boolean);
  items: SettingItemDef[];
}

export function resolveVisible(value: boolean | (() => boolean) | undefined): boolean {
  if (value === undefined) return true;
  return typeof value === "function" ? value() : value;
}

export function refreshSettingTab(tab: { display: () => void }): void {
  const updatable = tab as { update?: unknown; display: () => void };
  if (typeof updatable.update === "function") {
    (updatable.update as () => void).call(tab);
  } else {
    tab.display();
  }
}
