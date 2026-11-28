import { Alert, AlertDescription, AlertTitle } from "@crowhr/ui";
import { FlaskConical } from "lucide-react";
import { useT } from "../i18n/index.ts";

/** Required on every screen that renders src/fixtures data. */
export function SampleDataNotice({ children }: { children?: React.ReactNode }) {
  const t = useT("common");
  return (
    <Alert variant="sample" data-testid="sample-data-notice">
      <FlaskConical aria-hidden />
      <div>
        <AlertTitle>{t("Sample data")}</AlertTitle>
        <AlertDescription>{children ?? t("Everything on this page is sample data for the layout.")}</AlertDescription>
      </div>
    </Alert>
  );
}
