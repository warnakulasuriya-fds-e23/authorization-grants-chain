import { Html5Qrcode } from "html5-qrcode";
import { Camera, Keyboard, ScanLine } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Card, CardHeader, inputCls } from "../components/ui";

/** Accepts either a full consent URL (what the QR encodes) or a bare request code. */
function parseCode(text: string) {
  const m = text.match(/consent\/([A-Za-z0-9]+)/);
  return (m ? m[1] : text).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export default function Scan() {
  const navigate = useNavigate();
  const [cameraError, setCameraError] = useState("");
  const [code, setCode] = useState("");
  const scanner = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    const qr = new Html5Qrcode("qr-reader", { verbose: false });
    scanner.current = qr;
    let stopped = false;
    const started = qr.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 240, height: 240 } },
      (text) => {
        if (stopped) return;
        stopped = true;
        qr.stop().finally(() => navigate(`/consent/${parseCode(text)}`));
      },
      () => {},
    );
    started.catch((e) => setCameraError(String(e?.message ?? e)));
    return () => {
      stopped = true;
      // wait for start to settle before stopping, or html5-qrcode throws
      started.then(() => (qr.isScanning ? qr.stop() : undefined)).catch(() => {});
    };
  }, [navigate]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (code.trim()) navigate(`/consent/${parseCode(code)}`);
  };

  return (
    <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-5">
      <Card className="md:col-span-3">
        <CardHeader icon={<Camera className="size-5" />} title="Scan the verifier's QR code" subtitle="Point your camera at the code on their screen" />
        <div className="p-5">
          <div className="relative overflow-hidden rounded-2xl bg-black">
            <div id="qr-reader" className="min-h-72 w-full [&_video]:w-full [&_video]:object-cover" />
            {!cameraError && (
              <ScanLine className="pointer-events-none absolute left-1/2 top-1/2 size-16 -translate-x-1/2 -translate-y-1/2 text-cyan-300/40" />
            )}
          </div>
          {cameraError && (
            <div className="mt-4">
              <Alert tone="info">
                Camera unavailable ({cameraError}). Browsers only allow the camera on https or localhost — enter the code instead.
              </Alert>
            </div>
          )}
        </div>
      </Card>
      <Card className="md:col-span-2 self-start">
        <CardHeader icon={<Keyboard className="size-5" />} title="Or enter the code" subtitle="Shown under the QR code" />
        <form onSubmit={submit} className="space-y-4 p-5">
          <input
            className={`${inputCls} text-center font-mono text-lg uppercase tracking-[0.3em]`}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="XXXX-XXXX"
            maxLength={9}
          />
          <Button type="submit" className="w-full">Continue</Button>
        </form>
      </Card>
    </div>
  );
}
