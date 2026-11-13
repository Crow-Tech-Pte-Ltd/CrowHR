/**
 * Copy buttons (client side). A button with `data-copy` copies `data-copy-text`, or the text fetched from
 * `data-copy-src` (same origin). The label shows "Copied" for two seconds, and a polite live region says it
 * for screen readers.
 */
function status(): HTMLElement {
  let el = document.getElementById("crow-copy-status");
  if (!el) {
    el = document.createElement("div");
    el.id = "crow-copy-status";
    el.className = "sr-only";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.append(el);
  }
  return el;
}

async function source(button: HTMLButtonElement): Promise<string> {
  if (button.dataset.copyText !== undefined) return button.dataset.copyText;
  const res = await fetch(button.dataset.copySrc ?? "", { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function copy(button: HTMLButtonElement): Promise<void> {
  const text = source(button);
  // Safari only allows clipboard writes inside the click; ClipboardItem accepts the pending fetch.
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      const blob = text.then((t) => new Blob([t], { type: "text/plain" }));
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      return;
    } catch {
      // Fall through to writeText (older Firefox).
    }
  }
  await navigator.clipboard.writeText(await text);
}

export function initCopyButtons(root: ParentNode = document): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>("button[data-copy]")) {
    if (button.dataset.copyReady) continue;
    button.dataset.copyReady = "true";
    button.addEventListener("click", async () => {
      const label = button.querySelector<HTMLElement>("[data-copy-label]") ?? button;
      const original = label.dataset.original ?? label.textContent ?? "";
      label.dataset.original = original;
      try {
        await copy(button);
        label.textContent = "Copied";
        status().textContent = button.dataset.copyDone ?? "Copied to the clipboard";
      } catch {
        label.textContent = "Couldn't copy";
        status().textContent = "Couldn't copy. Select the text and copy it instead.";
      }
      window.setTimeout(() => {
        label.textContent = original;
      }, 2000);
    });
  }
}
