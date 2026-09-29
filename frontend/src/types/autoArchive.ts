export interface AutoArchiveConfig {
  enabled: boolean;
  competitions: string[];
  score_thresholds: Record<string, number>;
  interval_minutes: number;
  include_outputs: boolean;
  score_direction: 'auto' | 'minimize' | 'maximize';
}

export interface AutoArchiveItemResult {
  competition?: string;
  ref: string;
  public_score: number;
  status: 'archived' | 'skipped' | 'failed';
  version_number?: number;
  error?: string;
}

export interface AutoArchiveStatus {
  running: boolean;
  scheduler_alive: boolean;
  service_started_at?: string;
  scheduler_heartbeat_at?: string;
  last_checked_at?: string;
  next_run_at?: string;
  last_error?: string;
  checked_count: number;
  matched_count: number;
  archived_count: number;
  skipped_count: number;
  failed_count: number;
  competitions_checked?: string[];
  effective_score_direction?: 'minimize' | 'maximize';
  score_direction_source?: string;
  recent_results: AutoArchiveItemResult[];
}

export interface AutoArchiveRunLog {
  id: string;
  trigger: 'scheduled' | 'manual';
  outcome: 'success' | 'partial' | 'failed';
  started_at: string;
  finished_at: string;
  duration_seconds: number;
  checked_count: number;
  matched_count: number;
  archived_count: number;
  skipped_count: number;
  failed_count: number;
  competitions_checked?: string[];
  error?: string;
  details_available: boolean;
}

export interface AutoArchiveCheckedItem {
  competition?: string;
  ref: string;
  title: string;
  author: string;
  public_score?: number;
  last_run_time?: string;
  matched: boolean;
  action: 'not_matched' | 'archived' | 'skipped' | 'failed';
  version_number?: number;
  error?: string;
}

export interface AutoArchiveRunDetail {
  log: AutoArchiveRunLog;
  items: AutoArchiveCheckedItem[];
}

export interface AutoArchiveSnapshot {
  config: AutoArchiveConfig;
  status: AutoArchiveStatus;
  logs: AutoArchiveRunLog[];
}
