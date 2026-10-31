import { COMMON_BASE_WORDS, COMMON_PASSWORDS } from "./common-passwords.ts";

/**
 * Password policy (auth spec "Password policy and hashing"): 12–128 characters, not in the
 * bundled common list, not equal to the email. No composition rules (NIST SP 800-63B §3.1.1.2).
 */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

const COMMON = new Set(COMMON_PASSWORDS.map((p) => p.toLowerCase()));
const KEYBOARD_ROWS = ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm", "abcdefghijklmnopqrstuvwxyz"];

function isCommon(password: string): boolean {
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return true;
  // One repeated character, or one short chunk repeated ("abcabcabcabc").
  if (/^(.{1,4})\1+$/.test(lower)) return true;
  // A straight run along a keyboard row or the alphabet (either direction).
  const letters = lower.replace(/[^a-z0-9]/g, "");
  if (letters.length >= PASSWORD_MIN - 2) {
    for (const row of KEYBOARD_ROWS) {
      const doubled = row + row;
      const reversed = [...doubled].reverse().join("");
      if (doubled.includes(letters) || reversed.includes(letters)) return true;
    }
  }
  // A base word decorated only with digits and symbols ("Password!2026", "welcome@12345").
  const plain = lower.replace(/[^a-z]/g, "");
  const unleet = lower
    .replace(/@/g, "a")
    .replace(/0/g, "o")
    .replace(/\$/g, "s")
    .replace(/[^a-z]/g, "");
  return COMMON_BASE_WORDS.some((w) => plain === w || unleet === w);
}

/** Returns a message saying how to fix the password, or null when it is acceptable. */
export function passwordProblem(password: string, email?: string | null): string | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN) {
    return `Use at least ${PASSWORD_MIN} characters. A short phrase of a few unrelated words works well.`;
  }
  if (length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (email && password.trim().toLowerCase() === email.trim().toLowerCase()) {
    return "Don't use your email address as your password. Choose something only you would know.";
  }
  if (isCommon(password)) {
    return "This password is too common and easy to guess. Choose a longer, less predictable one, such as a few unrelated words.";
  }
  return null;
}
