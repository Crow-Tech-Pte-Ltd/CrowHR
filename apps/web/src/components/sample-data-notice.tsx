import { Alert, AlertDescription, AlertTitle } from "@crowhr/ui";
import { FlaskConical } from "lucide-react";

/** Required on every screen that renders src/fixtures data. */
export function SampleDataNotice({ children }: { children?: React.ReactNode }) {
  return (
    <Alert variant="sample" data-testid="sample-data-notice">
      <FlaskConical aria-hidden />
      <div>
        <AlertTitle>Sample data</AlertTitle>
        <AlertDescription>
          {children ?? "Everything on this page is made-up fixture data for layout. Nothing is connected yet."}
        </AlertDescription>
      </div>
    </Alert>
  );
}
