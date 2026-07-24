import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/staff/quotations")({
  component: QuotationsRedirect,
});

function QuotationsRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    void navigate({ to: "/staff/quotes", replace: true });
  }, [navigate]);

  return <div className="text-sm text-muted-foreground">Redirecting to quotes...</div>;
}
