export interface SubmissionMonitorConfig {
  enabled: boolean;
  competitions: string[];
  interval_minutes: number;
  page_size: number;
  description_prefix: string;
}

export interface SubmissionScoreEvent {
  competition?: string;
  ref: string;
  description: string;
  public_score: number;
  public_score_display: string;
  status: string;
  date?: string;
  scored_at?: string;
  submitted_by?: string;
  submitted_by_ref?: string;
  team_name?: string;
  previous_public_score?: number;
}

export interface SubmissionMonitorItem {
  competition?: string;
  ref: string;
  description: string;
  status: string;
  error_description?: string;
  submitted_by?: string;
  submitted_by_ref?: string;
  team_name?: string;
  public_score?: number;
  public_score_display?: string;
  date?: string;
  scored_at?: string;
  state?: 'pending' | 'scored' | 'failed';
  watched: boolean;
  newly_scored: boolean;
}

export interface SubmissionMonitorStatus {
  running: boolean;
  scheduler_alive: boolean;
  service_started_at?: string;
  scheduler_heartbeat_at?: string;
  last_checked_at?: string;
  next_run_at?: string;
  last_error?: string;
  checked_count: number;
  pending_count: number;
  scored_count: number;
  failed_count: number;
  newly_scored_count: number;
  competitions_checked?: string[];
  recent_events: SubmissionScoreEvent[];
  recent_items: SubmissionMonitorItem[];
}

export interface SubmissionMonitorRunLog {
  id: string;
  trigger: 'scheduled' | 'manual';
  outcome: 'success' | 'partial' | 'failed';
  started_at: string;
  finished_at: string;
  duration_seconds: number;
  checked_count: number;
  pending_count: number;
  scored_count: number;
  failed_count: number;
  newly_scored_count: number;
  competitions_checked?: string[];
  error?: string;
  details_available?: boolean;
}

export interface SubmissionMonitorRunDetail {
  log: SubmissionMonitorRunLog;
  items: SubmissionMonitorItem[];
}

export interface SubmissionMonitorSnapshot {
  config: SubmissionMonitorConfig;
  status: SubmissionMonitorStatus;
  logs: SubmissionMonitorRunLog[];
}
