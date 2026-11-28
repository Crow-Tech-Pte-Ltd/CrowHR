import type { ErrorEnvelope } from "@crowhr/core";
import { ApiError } from "./api.ts";

export interface Excluded {
  employeeName: string;
  reason: string;
}

/** Downloads a generated file (sensitive exports may answer 403 reauth_required: wrap in useReauth). */
export async function downloadApiFile(path: string): Promise<{ fileName: string; excluded: Excluded[] }> {
  const res = await fetch(path, { credentials: "same-origin" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ErrorEnvelope | null;
    throw new ApiError(res.status, body);
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  let fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "download";
  const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (encodedName) {
    try {
      fileName = decodeURIComponent(encodedName) || fileName;
    } catch {
      // Keep the ASCII name when the encoded filename is malformed.
    }
  }
  const excluded = JSON.parse(decodeURIComponent(res.headers.get("x-crowhr-excluded") ?? "%5B%5D")) as Excluded[];
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return { fileName, excluded };
}
