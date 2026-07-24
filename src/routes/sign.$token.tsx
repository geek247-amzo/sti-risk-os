import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

type SignoffResponse = {
  ok: true;
  link: {
    id: string;
    targetType: "service_report" | "job_card" | "quote";
    targetId: string;
    status: string;
    expiresAt: string | null;
  };
  target: {
    title: string;
    summary: string | null;
    organizationName: string | null;
    projectName: string | null;
    reportStatus: string | null;
    jobCardStatus: string | null;
    quoteNumber?: string | null;
    quoteStatus?: string | null;
    siteName?: string | null;
    totalValueCents?: number | null;
  };
  signature: {
    signedAt: string;
    signerName: string;
    signerRole: string | null;
    signatureData: Record<string, unknown>;
  } | null;
};

type Point = { x: number; y: number; t: number };

export const Route = createFileRoute("/sign/$token")({
  component: ClientSignoff,
});

function ClientSignoff() {
  const { token } = Route.useParams();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const strokesRef = useRef<Point[][]>([]);
  const currentStrokeRef = useRef<Point[]>([]);
  const drawingRef = useRef(false);
  const [data, setData] = useState<SignoffResponse | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [signerName, setSignerName] = useState("");
  const [signerRole, setSignerRole] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/client-signoff/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Unable to load sign-off");
        setData(body as SignoffResponse);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load sign-off"));
  }, [token]);

  const signed = Boolean(data?.signature);

  const canvasSize = useMemo(() => ({ height: 220 }), []);

  useEffect(() => {
    function resizeCanvas() {
      const canvas = canvasRef.current;
      const wrapper = wrapperRef.current;
      if (!canvas || !wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const width = Math.max(280, Math.floor(rect.width));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(canvasSize.height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${canvasSize.height}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawCanvas(context, width, canvasSize.height);
    }

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasSize.height]);

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    const wrapper = wrapperRef.current;
    if (!context || !wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    drawCanvas(context, Math.max(280, Math.floor(rect.width)), canvasSize.height);
  }, [data, canvasSize.height]);

  function drawCanvas(context: CanvasRenderingContext2D, width: number, height: number) {
    context.clearRect(0, 0, width, height);
    context.lineWidth = 2.5;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#111827";
    for (const stroke of strokesRef.current) {
      drawStroke(context, stroke);
    }
    if (currentStrokeRef.current.length > 0) {
      drawStroke(context, currentStrokeRef.current);
    }
    if (!strokesRef.current.length && !currentStrokeRef.current.length) {
      context.fillStyle = "#6b7280";
      context.font = "14px sans-serif";
      context.fillText("Sign here", 16, 28);
    }
  }

  function drawStroke(context: CanvasRenderingContext2D, stroke: Point[]) {
    if (stroke.length === 0) return;
    context.beginPath();
    context.moveTo(stroke[0].x, stroke[0].y);
    for (const point of stroke.slice(1)) {
      context.lineTo(point.x, point.y);
    }
    context.stroke();
  }

  function pointerPoint(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      t: Date.now(),
    };
  }

  function redrawSoon() {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const context = canvasRef.current?.getContext("2d");
      const wrapper = wrapperRef.current;
      if (!context || !wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      drawCanvas(context, Math.max(280, Math.floor(rect.width)), canvasSize.height);
    });
  }

  function onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (signed) return;
    const point = pointerPoint(event);
    if (!point) return;
    drawingRef.current = true;
    currentStrokeRef.current = [point];
    canvasRef.current?.setPointerCapture(event.pointerId);
    redrawSoon();
  }

  function onPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || signed) return;
    const point = pointerPoint(event);
    if (!point) return;
    currentStrokeRef.current = [...currentStrokeRef.current, point];
    redrawSoon();
  }

  function finishStroke(event?: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (currentStrokeRef.current.length > 0) {
      strokesRef.current = [...strokesRef.current, currentStrokeRef.current];
    }
    currentStrokeRef.current = [];
    redrawSoon();
    if (event) {
      try {
        canvasRef.current?.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    }
  }

  function clearPad() {
    if (signed) return;
    strokesRef.current = [];
    currentStrokeRef.current = [];
    redrawSoon();
  }

  async function submitSignature() {
    if (!signerName.trim()) {
      setError("Signer name is required");
      return;
    }
    if (!strokesRef.current.length && !currentStrokeRef.current.length) {
      setError("Signature is required");
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const signatureData = {
      format: "canvas-png",
      imageDataUrl: canvas.toDataURL("image/png"),
      strokes: [...strokesRef.current, ...(currentStrokeRef.current.length ? [currentStrokeRef.current] : [])],
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    };
    setIsSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/client-signoff/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signerName,
          signerRole: signerRole || null,
          signatureData,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to submit signature");
      setNotice("Sign-off captured.");
      setData((current) =>
        current
          ? {
              ...current,
              signature: {
                signedAt: new Date().toISOString(),
                signerName,
                signerRole: signerRole || null,
                signatureData,
              },
            }
          : current,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit signature");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Client sign-off
          </div>
          <h1 className="text-3xl font-bold">{data?.target.title ?? "Loading sign-off"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {data?.target.organizationName ?? "Client"}{data?.target.projectName ? ` · ${data.target.projectName}` : ""}
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            {notice}
          </div>
        )}

        <div className="rounded-lg border border-border/60 bg-surface p-5">
          <div className="space-y-2 text-sm">
            <div>
              <span className="font-semibold">Status:</span>{" "}
              {signed ? "Signed" : data?.link.status === "active" ? "Awaiting signature" : "Closed"}
            </div>
            <div>
              <span className="font-semibold">Work:</span> {data?.target.summary ?? "Completed work"}
            </div>
            {data?.signature && (
              <div>
                <span className="font-semibold">Signed by:</span> {data.signature.signerName}
                {data.signature.signerRole ? ` · ${data.signature.signerRole}` : ""}
              </div>
            )}
          </div>
        </div>

        {!signed && (
          <div className="space-y-4 rounded-lg border border-border/60 bg-white p-5">
            <label className="block">
              <div className="mb-1 text-sm font-medium">Name</div>
              <input
                value={signerName}
                onChange={(event) => setSignerName(event.target.value)}
                placeholder="Signer name"
                className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
              />
            </label>
            <label className="block">
              <div className="mb-1 text-sm font-medium">Role or relationship</div>
              <input
                value={signerRole}
                onChange={(event) => setSignerRole(event.target.value)}
                placeholder="Client contact, manager, owner..."
                className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
              />
            </label>

            <div ref={wrapperRef} className="overflow-hidden rounded-lg border border-border bg-surface-2">
              <canvas
                ref={canvasRef}
                className="touch-none block w-full bg-white"
                style={{ height: `${canvasSize.height}px` }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={finishStroke}
                onPointerCancel={finishStroke}
                onPointerLeave={finishStroke}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={clearPad}
                className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-surface-2"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => void submitSignature()}
                disabled={isSubmitting}
                className="rounded-md bg-brand-orange px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {isSubmitting ? "Submitting" : "Sign off"}
              </button>
            </div>
          </div>
        )}

        {signed && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800">
            This sign-off has already been captured.
          </div>
        )}
      </div>
    </div>
  );
}
