// Crow HR: applies the saved theme before the first paint, so a dark page never flashes white.
// "system" (the default) follows the device; the account menu stores "light" or "dark" in this
// browser (localStorage "crowhr.theme"). Kept in step with apps/web/src/shell/theme.ts.
(() => {
  var pref = null;
  try {
    pref = localStorage.getItem("crowhr.theme");
  } catch {
    // Storage blocked (some private modes): follow the device.
  }
  var dark =
    pref === "dark" ||
    (pref !== "light" && !!window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  var root = document.documentElement;
  if (dark) root.classList.add("dark");
  root.style.colorScheme = dark ? "dark" : "light";
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#141414" : "#FFFFFF");
})();
