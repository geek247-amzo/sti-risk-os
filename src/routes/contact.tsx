import { createFileRoute } from "@tanstack/react-router";
import { LeadCaptureForm } from "@/components/crm/LeadCaptureForm";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact — STI Risk" },
      { name: "description", content: "Get in touch with STI Risk." },
    ],
  }),
  component: Contact,
});

function Contact() {
  return (
    <LeadCaptureForm
      source="contact_form"
      heading="Contact STI Risk"
      intro="Send a project, inspection, or site-risk enquiry into the STI Risk CRM. The team will review the lead, qualify the requirement, and respond with next steps."
    />
  );
}
