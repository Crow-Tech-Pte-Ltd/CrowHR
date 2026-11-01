import type { IndexHtmlTransformContext, Plugin } from "vite";

type OutputBundle = NonNullable<IndexHtmlTransformContext["bundle"]>;

/** Start downloading the web app during database boot, without evaluating it before the API exists. */
export function appPreloads(bundle: OutputBundle): string[] {
  const entry = Object.values(bundle).find(
    (chunk) => chunk.type === "chunk" && !!chunk.facadeModuleId?.endsWith("/apps/web/src/main.tsx"),
  );
  const files = new Set<string>();
  const visit = (name: string) => {
    if (files.has(name)) return;
    files.add(name);
    const chunk = bundle[name];
    if (chunk?.type === "chunk") for (const dependency of chunk.imports) visit(dependency);
  };
  if (entry) visit(entry.fileName);
  return [...files];
}

export function preloadApp(): Plugin {
  return {
    name: "crowhr-demo:preload-app",
    transformIndexHtml: {
      order: "post",
      handler: (_html, ctx) =>
        ctx.bundle
          ? appPreloads(ctx.bundle).map((file) => ({
              tag: "link",
              attrs: { rel: "modulepreload", href: `/${file}`, crossorigin: "" },
              injectTo: "head",
            }))
          : [],
    },
  };
}
