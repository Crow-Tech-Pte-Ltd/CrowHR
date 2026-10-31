import { createFileRoute } from "@tanstack/react-router";
import { SIGN_IN_FIXTURES, type SignInFixture } from "../sign-in/methods.ts";
import { SignInPage } from "../sign-in/sign-in-page.tsx";

// NOT IMPLEMENTED: the enabled methods will come from the API for the
// organisation being signed in to. `?methods=all|password|sso` picks a fixture.
export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): { methods?: SignInFixture } => {
    const m = search.methods;
    return m === "all" || m === "password" || m === "sso" ? { methods: m } : {};
  },
  component: SignInRoute,
});

function SignInRoute() {
  const { methods = "all" } = Route.useSearch();
  return <SignInPage methods={SIGN_IN_FIXTURES[methods]} />;
}
