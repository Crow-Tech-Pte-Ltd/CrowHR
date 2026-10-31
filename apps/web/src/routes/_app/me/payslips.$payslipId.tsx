import { Card, Skeleton } from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import { myPayslipQuery } from "../payroll/-lib/api.ts";
import { PayslipDocument } from "../payroll/-lib/ui.tsx";

export const Route = createFileRoute("/_app/me/payslips/$payslipId")({
  component: MyPayslip,
});

function MyPayslip() {
  const { payslipId } = Route.useParams();
  const q = useQuery(myPayslipQuery(payslipId));
  return (
    <>
      <PageHeader crumbs={[{ label: "Payslips", to: "/me/payslips" }]} title={q.data?.title ?? "Payslip"} />
      {q.isPending ? (
        <Skeleton className="mx-auto h-[36rem] max-w-3xl" />
      ) : q.isError ? (
        <Card>
          <ErrorNote error={q.error} retry={() => void q.refetch()} />
        </Card>
      ) : (
        <PayslipDocument slip={q.data} pdfHref={`/api/v1/payslips/${payslipId}/pdf`} />
      )}
    </>
  );
}
