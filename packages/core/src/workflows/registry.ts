import { SUBJECT_TYPE_PATTERN } from "../db/schema/workflows.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import { approvalsInbox } from "./inbox-approvals.ts";
import { peopleInboxSources, peopleReminderSources } from "./reminders.ts";
import type { AnySubjectAdapter, InboxSource, ReminderSource, Transition, WorkflowPlugin } from "./types.ts";

/**
 * Workflow plugins shipped with core. A module adds one line here (like `V1_MODULES` in app.ts):
 *
 *   export const CORE_WORKFLOW_PLUGINS = [leaveWorkflowPlugin, claimsWorkflowPlugin];
 *
 * Hosts and tests add more through `deps.workflowPlugins`.
 */
export const CORE_WORKFLOW_PLUGINS: readonly WorkflowPlugin[] = [];

export interface WorkflowRegistry {
  subjects: ReadonlyMap<string, AnySubjectAdapter>;
  subject(type: string): AnySubjectAdapter;
  inbox: readonly InboxSource[];
  reminders: readonly ReminderSource[];
  transitions: readonly Transition[];
}

const cache = new WeakMap<object, WorkflowRegistry>();

function build(deps: AppDeps): WorkflowRegistry {
  const plugins = [...CORE_WORKFLOW_PLUGINS, ...(deps.workflowPlugins ?? [])];
  const subjects = new Map<string, AnySubjectAdapter>();
  for (const plugin of plugins) {
    for (const adapter of plugin.subjects ?? []) {
      if (!SUBJECT_TYPE_PATTERN.test(adapter.type)) {
        throw new Error(`Workflow plugin ${plugin.name}: subject type "${adapter.type}" must be lower snake case.`);
      }
      if (subjects.has(adapter.type)) {
        throw new Error(`Workflow plugin ${plugin.name}: subject type "${adapter.type}" is registered twice.`);
      }
      subjects.set(adapter.type, adapter);
    }
  }
  return {
    subjects,
    subject(type) {
      const adapter = subjects.get(type);
      if (!adapter) throw new AppError("not_found", `No module handles "${type}" requests on this server.`);
      return adapter;
    },
    inbox: [approvalsInbox(deps), ...peopleInboxSources(deps), ...plugins.flatMap((p) => p.inbox ?? [])],
    reminders: [...peopleReminderSources(deps), ...plugins.flatMap((p) => p.reminders ?? [])],
    transitions: plugins.flatMap((p) => p.transitions ?? []),
  };
}

/** The registry for these deps (memoised per deps object; plugins are fixed at app construction). */
export function workflowRegistry(deps: AppDeps): WorkflowRegistry {
  let found = cache.get(deps);
  if (!found) {
    found = build(deps);
    cache.set(deps, found);
  }
  return found;
}
