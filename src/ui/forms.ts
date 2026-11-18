import { Notice, Setting } from "obsidian";
import type { Labels } from "../i18n/en";
import { confidenceLevels } from "../domain/types";

export function field(el: HTMLElement, label: string, area = false) {
  const setting = new Setting(el).setName(label);
  let input: HTMLInputElement | HTMLTextAreaElement;
  if (area) {
    setting.settingEl.addClass("cl-textarea-setting");
    setting.addTextArea(component => {
      input = component.inputEl;
      component.inputEl.rows = 6;
    });
  }
  else setting.addText(component => { input = component.inputEl; });
  labelControl(setting, input!);
  return input!;
}

let nextLabel = 0;
export function labelControl(setting: Setting, element: HTMLElement) {
  setting.nameEl.id ||= "cl-label-" + ++nextLabel;
  element.setAttribute("aria-labelledby", setting.nameEl.id);
}

export function dropdown(el: HTMLElement, label: string, options: Record<string, string>) {
  const setting = new Setting(el).setName(label);
  let input: HTMLSelectElement;
  setting.addDropdown(component => {
    component.addOptions(options);
    if (Object.prototype.hasOwnProperty.call(options, "")) component.setValue("");
    input = component.selectEl;
  });
  labelControl(setting, input!);
  return input!;
}

export function confidenceInput(el: HTMLElement, tr: Labels) {
  const input = dropdown(el, tr.confidence, { "": tr.choose, 50: "50%", 70: "70%", 90: "90%" });
  return () => confidenceLevels.find(value => String(value) === input.value);
}

export function action(el: HTMLElement, label: string, fn: () => void | Promise<void>, tr: Labels, primary = false) {
  const button = el.createEl("button", { text: label, cls: primary ? "mod-cta" : "", attr: { type: "button" } });
  button.addEventListener("click", () => {
    button.disabled = true;
    void Promise.resolve().then(fn).catch(() => new Notice(tr.failed))
      .finally(() => { button.disabled = false; });
  });
  return button;
}
