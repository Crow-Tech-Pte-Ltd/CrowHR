import type { ReactNode } from "react";

export function ReportGroups({ children }: { children: ReactNode }) {
  return (
    <div className="[container-type:inline-size]">
      <div className="grid items-start gap-x-5 gap-y-6 [@container(min-width:52rem)]:grid-cols-2 [&>section:only-child]:col-span-full">
        {children}
      </div>
    </div>
  );
}
