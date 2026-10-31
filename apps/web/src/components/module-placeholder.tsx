import { EmptyState } from "@crowhr/ui";
import { MODULES, type ModuleId } from "../shell/nav.ts";
import { PageHeader } from "./page-header.tsx";

/** Honest placeholder for a module that has not been built yet. */
export function ModulePlaceholder({ module }: { module: ModuleId }) {
  const m = MODULES[module];
  const Icon = m.icon;
  return (
    <>
      <PageHeader title={m.label} description={m.summary} />
      <EmptyState
        data-testid="module-empty-state"
        icon={<Icon />}
        title={m.emptyTitle}
        description={m.emptyBody}
        note={`${m.label} is not available yet`}
      />
    </>
  );
}
