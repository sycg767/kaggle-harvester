import type { ActiveCompetitionInfo, ArchiveStats } from './kernels';
import type { AutoArchiveStatus } from './autoArchive';
import type { NotificationStatus } from './notifications';
import type { SimulationMonitorStatus } from './simulation';
import type { SubmissionMonitorStatus } from './submissions';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  ready: boolean;
  kaggle_cli: boolean;
  token_configured: boolean;
  utf8_wrapper: string;
  utf8_wrapper_exists: boolean;
  default_competition: string;
  active_competition?: ActiveCompetitionInfo;
  archive: ArchiveStats;
  cache: Record<string, string | number>;
  auto_archive: AutoArchiveStatus;
  submission_monitor?: SubmissionMonitorStatus;
  simulation_monitor?: SimulationMonitorStatus;
  notifications?: NotificationStatus;
}
