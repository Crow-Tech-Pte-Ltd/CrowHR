import { Card, Skeleton } from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import { adminPayslipQuery, runQuery, runTitle } from "./-lib/api.ts";
import { PayslipDocument } from "./-lib/ui.tsx";

export const Route = createFileRoute("/_app/payroll/runs/$runId/payslips/$payslipId")({
  component: AdminPayslip,
});

function AdminPayslip() {
  const { runId, payslipId } = Route.useParams();
  const run = useQuery(runQuery(runId));
  const slip = useQuery(adminPayslipQuery(runId, payslipId));
  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Payroll", to: "/payroll" },
          { label: run.data ? runTitle(run.data.run) : "Run", to: `/payroll/runs/${runId}` },
        ]}
        title={slip.data ? slip.data.employee.name : "Payslip"}
        description={
          slip.data?.releasedAt
            ? "Released: the employee can see this payslip in Me → Payslips."
            : "Preview: employees see payslips only after the run is approved and released."
        }
      />
      {slip.isPending ? (
        <Skeleton className="mx-auto h-[36rem] max-w-3xl" />
      ) : slip.isError ? (
        <Card>
          <ErrorNote error={slip.error} retry={() => void slip.refetch()} />
        </Card>
      ) : (
        <PayslipDocument slip={slip.data} pdfHref={`/api/v1/payroll/runs/${runId}/payslips/${payslipId}/pdf`} />
      )}
    </>
  );
}
