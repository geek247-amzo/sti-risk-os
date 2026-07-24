import { createFileRoute } from "@tanstack/react-router";
import { Mic } from "lucide-react";
import { ComingSoon } from "../components/staff/ComingSoon";

export const Route = createFileRoute("/staff/voice")({
  component: Voice,
});

function Voice() {
  return (
    <ComingSoon
      title="Voice"
      eyebrow="Knowledge Capture"
      description="VoIP call review, lessons learned, and communication improvement workflow."
      icon={Mic}
    />
  );
}
