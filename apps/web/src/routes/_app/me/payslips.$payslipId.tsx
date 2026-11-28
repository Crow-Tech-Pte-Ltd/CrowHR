import { Card, Skeleton } from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import { useLocale, useT } from "../../../i18n/index.ts";
import { myPayslipQuery, payslipTitle } from "../payroll/-lib/api.ts";
import { PayslipDocument } from "../payroll/-lib/ui.tsx";

export const Route = createFileRoute("/_app/me/payslips/$payslipId")({
  component: MyPayslip,
});

function MyPayslip() {
  const t = useT("people-payroll");
  const locale = useLocale();
  const { payslipId } = Route.useParams();
  const q = useQuery(myPayslipQuery(payslipId));
  return (
    <>
      <PageHeader
        crumbs={[{ label: t("Payslips"), to: "/me/payslips" }]}
        title={q.data ? payslipTitle(q.data, q.data.periodStart.slice(0, 7), locale) : t("Payslip")}
      />
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
