"use client";

import { AirfieldOverview } from "./AirfieldOverview";
import { EventTimeline, FullLogOverlay } from "./EventTimeline";
import { Header } from "./Header";
import { RiskGaugeCard, SafetyStatusCard, StatusCardGrid } from "./LeftColumn";
import { MonitoringView } from "./MonitoringView";
import { LiveAlertsPanel, RiskHeatmapPanel, SystemSummaryPanel } from "./RightColumn";
import { SimulationControls } from "./SimulationControls";
import { SimRuntime } from "@/sim/SimRuntime";

export function Dashboard() {
  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-[#030b14]">
      <SimRuntime />
      <Header />

      <main
        className="grid min-h-0 min-w-0 flex-1 grid-cols-[19fr_55fr_26fr] overflow-hidden"
        style={{ gap: "var(--pad)", padding: "var(--pad)" }}
      >
        {/* left */}
        <section
          className="flex min-h-0 min-w-0 flex-col"
          style={{ gap: "var(--pad)" }}
        >
          <SafetyStatusCard />
          <RiskGaugeCard />
          <StatusCardGrid />
          <AirfieldOverview />
        </section>

        {/* centre */}
        <section
          className="flex min-h-0 min-w-0 flex-col"
          style={{ gap: "var(--pad)" }}
        >
          <MonitoringView />
          <EventTimeline />
        </section>

        {/* right */}
        <section
          className="flex min-h-0 min-w-0 flex-col"
          style={{ gap: "var(--pad)" }}
        >
          <LiveAlertsPanel />
          <RiskHeatmapPanel />
          <SystemSummaryPanel />
        </section>
      </main>

      <footer
        className="flex shrink-0 items-center justify-center"
        style={{ height: "var(--ftr-h)" }}
      >
        <span className="text-[10.5px] font-normal tracking-[0.03em] text-[#3f5a6e]">
          Made by Awaiz Ahmed
        </span>
      </footer>

      <SimulationControls />
      <FullLogOverlay />
    </div>
  );
}
