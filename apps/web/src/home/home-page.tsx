import { useMe } from "../auth/session.ts";
import { useViewMode } from "../shell/view-mode.tsx";
import { AdminHome } from "./admin-home.tsx";
import { EmployeeHome } from "./employee-home.tsx";

/**
 * Members who approve or administer (owner, HR/payroll admin, managers) get the work-to-do Home;
 * the user-menu preview toggle can still switch them to the employee layout. Everyone else gets
 * the employee Home.
 */
export function HomePage() {
  const me = useMe();
  const { mode } = useViewMode();
  const approver = me.roles.some((r) => r !== "employee");
  return approver && mode !== "employee" ? <AdminHome /> : <EmployeeHome />;
}
