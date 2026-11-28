export const TOPICS = {
  access: {
    title: "Sign-in and invitations",
    steps: [
      "Check the company’s Crow HR address and use the work email on your invitation. If the company uses single sign-on, choose its provider button.",
      "If an invitation expired or never arrived, an owner or HR admin can resend it in Members and roles. When email is unavailable, they can copy the link and share it with you.",
      "Use Forgot password when it is available. For a lost authenticator or a locked account, ask your company administrator for recovery. If you use Google or Microsoft, check access with your company’s identity administrator.",
    ],
    guide: "/help/troubleshooting/#signing-in",
  },
  permissions: {
    title: "Missing access or an employee record",
    steps: [
      "Check the organisation shown in the app. If you belong to more than one company, switch to the one where you need access.",
      "Personal leave, claims and payslips require your sign-in to be linked to your employee record. Ask your company administrator to check the link in Members and roles.",
      "Tell the company administrator what task you need to complete. Owners can give the smallest role that fits the job. Managers’ team access follows reporting lines in People.",
    ],
    guide: "/roles-and-permissions/",
  },
  approvals: {
    title: "A request is waiting for approval",
    steps: [
      "Open My requests in your Inbox and find the submission. Its status tells you whether it is waiting for a decision or needs you to make a change.",
      "If a colleague cannot see it in their Inbox, ask your company administrator to check the approver, manager relationship and out-of-office cover.",
      "An owner or HR admin with policy access can check approval steps and escalation in Settings. Keep approval roles separate from the person submitting payroll.",
    ],
    guide: "/approvals/approvals/",
  },
  payroll: {
    title: "Payroll and payslips",
    steps: [
      "A payslip becomes visible after the payroll team releases it. Confirm you are in the right company and ask payroll whether the run was released.",
      "If you run payroll, open the run and work through its blocking issues. Use the fix action beside an issue when available, then recompute and review the run.",
      "If a file excludes someone, read the reason shown with the download. Check the employee’s bank account on the pay date or the relevant statutory fields before downloading again.",
    ],
    guide: "/payroll/running-payroll/",
  },
  attendance: {
    title: "Missed punches and leave balances",
    steps: [
      "Check your timesheet to see which punches reached the server. Submit a correction for a missing or incorrect punch.",
      "For a blocked clock-in, check the app’s location permission and the company’s network or work-site requirements. Your company administrator can check the attendance policy.",
      "For a leave balance, check the selected leave year and any pending requests. Ask HR to review the entitlement or record a correction if the balance is wrong.",
    ],
    guide: "/help/troubleshooting/#attendance",
  },
  service: {
    title: "Server, backups and errors",
    steps: [
      "Check the server connection, then try a read action such as reopening the page. Before resubmitting a payment or request, check whether the first attempt succeeded.",
      "Owners can check database, backups and reverse-proxy status in System. Self-hosted owners can also run crowhr doctor on the server.",
      "If you still need help, include the request reference and steps to reproduce. Remove staff names, identity numbers, pay amounts and screenshots with employee data.",
    ],
    guide: "/self-hosting/troubleshooting/",
  },
} as const;

export type Topic = keyof typeof TOPICS;

export function helpTopic(value: unknown): Topic | undefined {
  return typeof value === "string" && Object.hasOwn(TOPICS, value) ? (value as Topic) : undefined;
}

export const DOCS = "https://hr.crow.sg/docs";
