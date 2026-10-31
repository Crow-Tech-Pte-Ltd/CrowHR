import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "../../home/home-page.tsx";

export const Route = createFileRoute("/_app/")({
  component: HomePage,
});
