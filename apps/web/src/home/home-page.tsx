import { useViewMode } from "../shell/view-mode.tsx";
import { AdminHome } from "./admin-home.tsx";
import { EmployeeHome } from "./employee-home.tsx";

export function HomePage() {
  const { mode } = useViewMode();
  return mode === "employee" ? <EmployeeHome /> : <AdminHome />;
}
