import { createFileRoute } from "@tanstack/react-router";
import { LeadCaptureForm } from "@/components/crm/LeadCaptureForm";

export const Route = createFileRoute("/partner-referral")({
  head: () => ({
    meta: [
      { title: "Partner & Referral — STI Risk" },
      { name: "description", content: "Partner with STI Risk." },
    ],
  }),
  component: PartnerReferral,
});

function PartnerReferral() {
  return (
    <LeadCaptureForm
      source="partner_referral"
      referral
      heading="Partner & Referral"
      intro="Refer an organization that needs industrial fire detection, suppression, risk auditing, or operational resilience support. Referrals create CRM opportunities for staff review."
    />
  );
}
