import { Card, Skeleton } from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import { useLocale, useT } from "../../../i18n/index.ts";
import { adminPayslipQuery, runQuery, runTitle } from "./-lib/api.ts";
import { PayslipDocument } from "./-lib/ui.tsx";

export const Route = createFileRoute("/_app/payroll/runs/$runId_/payslips/$payslipId")({
  component: AdminPayslip,
});

function AdminPayslip() {
  const t = useT("people-payroll");
  const locale = useLocale();
  const { runId, payslipId } = Route.useParams();
  const run = useQuery(runQuery(runId));
  const slip = useQuery(adminPayslipQuery(runId, payslipId));
  return (
    <>
      <PageHeader
        crumbs={[
          { label: t("Payroll"), to: "/payroll" },
          { label: run.data ? runTitle(run.data.run, locale) : t("Run"), to: `/payroll/runs/${runId}` },
        ]}
        title={slip.data ? slip.data.employee.name : t("Payslip")}
        description={
          slip.data?.releasedAt
            ? t("Released: the employee can see this payslip in Me → Payslips.")
            : t("Preview: employees see payslips only after the run is approved and released.")
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
