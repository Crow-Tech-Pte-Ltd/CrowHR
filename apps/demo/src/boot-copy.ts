import { getLocale, type MessageValues, translate } from "../../web/src/i18n/index.ts";

export function demoText(message: string, values?: MessageValues): string {
  return translate(getLocale(), "demo", message, values);
}

export function localiseBoot() {
  for (const element of document.querySelectorAll<HTMLElement>("[data-demo-message]")) {
    const source = element.textContent?.trim().replace(/\s+/g, " ");
    if (source) element.textContent = demoText(source);
  }
}

/** Boot actions are DOM nodes so translated messages and error details are always plain text. */
export function bootButton(label: string, onClick: () => void, id?: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  if (id) button.id = id;
  button.textContent = label;
  button.addEventListener("click", onClick, { once: true });
  return button;
}
