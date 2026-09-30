import type { SimulationMonitorStatus } from '../../types/simulation.ts';

// A saved configuration can change before the next scan; only the snapshot's
// own competition is evidence that its scores belong to the selected workspace.
export function selectSimulationData(status: SimulationMonitorStatus | undefined, competition: string) {
  const matches = Boolean(competition && status?.competition === competition);
  return {
    matches,
    agents: matches ? status?.agents || [] : [],
    thresholds: matches ? status?.thresholds || status?.medal_thresholds : undefined,
  };
}
