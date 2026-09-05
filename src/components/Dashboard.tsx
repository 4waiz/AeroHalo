"use client";

import { AirfieldOverview } from "./AirfieldOverview";
import { EventTimeline, FullLogOverlay } from "./EventTimeline";
import { Header } from "./Header";
import { RiskGaugeCard, SafetyStatusCard, StatusCardGrid } from "./LeftColumn";
import { MonitoringView } from "./MonitoringView";
import { LiveAlertsPanel, RiskHeatmapPanel, SystemSummaryPanel } from "./RightColumn";
import { SimulationControls } from "./SimulationControls";
import { SimRuntime } from "@/sim/SimRuntime";
import {
  LiveOperatorPanel,
  LiveOutputsPanel,
  LiveRangePanel,
  LiveRiskGaugeCard,
  LiveSafetyStatusCard,
  LiveStatusCardGrid,
} from "./LiveColumn";
import { LiveMonitoringView } from "./LiveMonitoringView";
import {
  LiveAlertsPanel as LiveHardwareAlerts,
  LiveEventTimeline,
  LiveSystemSummaryPanel,
} from "./LiveRightColumn";
import { useLive } from "@/live/liveStore";

export function Dashboard() {
  const live = useLive((s) => s.mode === "live");

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-[#030b14]">
      {/* The simulation keeps running behind LIVE so switching back is instant,
          but none of its output is rendered while LIVE is selected. */}
      <SimRuntime />
      <Header />

      <main
        className="grid min-h-0 min-w-0 flex-1 grid-cols-[19fr_55fr_26fr] overflow-hidden"
        style={{ gap: "var(--pad)", padding: "var(--pad)" }}
      >
        {/* left */}
        <section
          className="flex min-h-0 min-w-0 flex-col overflow-y-auto"
          style={{ gap: "var(--pad)" }}
        >
          {live ? (
            <>
              <LiveSafetyStatusCard />
              <LiveRiskGaugeCard />
              <LiveRangePanel />
              <LiveOutputsPanel />
              <LiveStatusCardGrid />
              <LiveOperatorPanel />
            </>
          ) : (
            <>
              <SafetyStatusCard />
              <RiskGaugeCard />
              <StatusCardGrid />
              <AirfieldOverview />
            </>
          )}
        </section>

        {/* centre */}
        <section
          className="flex min-h-0 min-w-0 flex-col"
          style={{ gap: "var(--pad)" }}
        >
          {live ? <LiveMonitoringView /> : <MonitoringView />}
          {live ? <LiveEventTimeline /> : <EventTimeline />}
        </section>

        {/* right */}
        <section
          className="flex min-h-0 min-w-0 flex-col"
          style={{ gap: "var(--pad)" }}
        >
          {live ? (
            <>
              <LiveHardwareAlerts />
              <LiveSystemSummaryPanel />
            </>
          ) : (
            <>
              <LiveAlertsPanel />
              <RiskHeatmapPanel />
              <SystemSummaryPanel />
            </>
          )}
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
