import React from "react";
import Link from "next/link";
import { Button } from "@/components";

export default function NotFoundPage() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center p-6 space-y-6">
      <div className="border-2 border-[#0A0A0A] bg-[#FAFAFA] p-8 sm:p-12 max-w-lg w-full space-y-6 shadow-[6px_6px_0px_0px_#0A0A0A]">
        <div className="flex items-center justify-center gap-2">
          <span className="w-4 h-4 bg-[#E63946] inline-block border border-[#0A0A0A]" />
          <span className="font-mono text-xs uppercase tracking-widest text-[#0A0A0A]/60">
            STATE MACHINE ERROR // 404
          </span>
        </div>

        <h1 className="font-['Archivo_Black'] text-6xl uppercase tracking-tight text-[#0A0A0A]">
          404
        </h1>

        <div className="border-t-2 border-b-2 border-[#0A0A0A] py-3 font-['Space_Grotesk'] font-bold text-sm uppercase">
          NODE ROUTE NOT FOUND
        </div>

        <p className="font-['Inter'] text-xs text-[#0A0A0A]/70 leading-relaxed">
          The requested agent node, review identifier, or telemetry view does not exist in the current research state graph.
        </p>

        <div className="pt-2">
          <Link href="/">
            <Button variant="primary" size="lg" className="w-full">
              &larr; Return to Dashboard
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
