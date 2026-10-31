import { attendanceWorkflowPlugin } from "../attendance/approval.ts";
import { claimsWorkflowPlugin } from "../claims/approval.ts";
import { SUBJECT_TYPE_PATTERN } from "../db/schema/workflows.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import { leaveWorkflowPlugin } from "../leave/approval.ts";
import { payrollWorkflowPlugin } from "../payroll/approval.ts";
import { schedulingWorkflowPlugin } from "../scheduling/swaps.ts";
import { approvalsInbox } from "./inbox-approvals.ts";
import { peopleWorkflowPlugin } from "./people.ts";
import { peopleInboxSources, peopleReminderSources } from "./reminders.ts";
import { systemWorkflowPlugin } from "./system.ts";
import type { AnySubjectAdapter, InboxSource, ReminderSource, Transition, WorkflowPlugin } from "./types.ts";

/**
 * Workflow plugins shipped with core. A module adds one line here (like `V1_MODULES` in app.ts):
 *
 *   export const CORE_WORKFLOW_PLUGINS = [peopleWorkflowPlugin, leaveWorkflowPlugin];
 *
 * An entry is a plugin, or a function of the deps that returns one (when its callbacks need
 * deps such as the clock or SecretBox). Hosts and tests add more through `deps.workflowPlugins`.
 */
export type CorePlugin = WorkflowPlugin | ((deps: AppDeps) => WorkflowPlugin);
// Arrow functions: the modules import workflows too, so resolve them at build time, not at load.
export const CORE_WORKFLOW_PLUGINS: readonly CorePlugin[] = [
  (deps) => peopleWorkflowPlugin(deps),
  (deps) => systemWorkflowPlugin(deps),
  (deps) => payrollWorkflowPlugin(deps),
  (deps) => claimsWorkflowPlugin(deps),
  (deps) => leaveWorkflowPlugin(deps),
  (deps) => attendanceWorkflowPlugin(deps),
  (deps) => schedulingWorkflowPlugin(deps),
];

export interface WorkflowRegistry {
  subjects: ReadonlyMap<string, AnySubjectAdapter>;
  subject(type: string): AnySubjectAdapter;
  inbox: readonly InboxSource[];
  reminders: readonly ReminderSource[];
  transitions: readonly Transition[];
}

const cache = new WeakMap<object, WorkflowRegistry>();

function build(deps: AppDeps): WorkflowRegistry {
  const core = CORE_WORKFLOW_PLUGINS.map((p) => (typeof p === "function" ? p(deps) : p));
  const extra = deps.workflowPlugins ?? [];
  const subjects = new Map<string, AnySubjectAdapter>();
  // A host or test plugin may replace a core subject type (e.g. the engine's fake `leave` module in
  // workflows tests); the replaced core plugin's other contributions stay. Within one group a type
  // registered twice is an error.
  const replaced = new Set(extra.flatMap((p) => (p.subjects ?? []).map((a) => a.type)));
  for (const [group, list] of [
    ["core", core],
    ["extra", extra],
  ] as const) {
    const seen = new Set<string>();
    for (const plugin of list) {
      for (const adapter of plugin.subjects ?? []) {
        if (!SUBJECT_TYPE_PATTERN.test(adapter.type)) {
          throw new Error(`Workflow plugin ${plugin.name}: subject type "${adapter.type}" must be lower snake case.`);
        }
        if (seen.has(adapter.type)) {
          throw new Error(`Workflow plugin ${plugin.name}: subject type "${adapter.type}" is registered twice.`);
        }
        seen.add(adapter.type);
        if (group === "core" && replaced.has(adapter.type)) continue;
        subjects.set(adapter.type, adapter);
      }
    }
  }
  const plugins = [...core, ...extra];
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
