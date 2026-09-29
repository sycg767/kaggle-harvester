/** API types matching backend models. */

export interface CompetitionInfo {
  id: string;
  title: string;
  category: string;
  deadline?: string;
  reward?: string;
  team_count?: number;
  kernel_count?: number;
  evaluation_metric?: string;
  description?: string;
  is_lower_better: boolean;
  score_direction_source: 'api' | 'leaderboard' | 'metric' | 'fallback';
  is_simulation?: boolean;
  tags?: string[];
}

export interface ScoredKernel {
  ref: string;
  title: string;
  author: string;
  public_score?: number;
  public_score_display?: string;
  vote_count: number;
  total_votes: number;
  is_competition_kernel: boolean;
  kernel_type: string;
  category: string;
  last_run_time?: string;
  competition?: string;
}

export interface VersionInfo {
  version_number: number;
  title: string;
  status: string;
  date_created: string;
  public_lb?: string;
  public_lb_numeric?: number;
  script_version_id?: number;
}

export interface VersionScoreList {
  owner_slug: string;
  kernel_slug: string;
  versions: VersionInfo[];
}

export interface ArchiveEntry {
  id: string;
  ref: string;
  title: string;
  author: string;
  archived_at: string;
  path: string;
  version_number: number;
  public_score?: number;
  competition?: string;
  source_file?: string;
  file_count: number;
  size_bytes: number;
  include_outputs: boolean;
}

export interface ArchiveResult {
  owner_slug: string;
  kernel_slug: string;
  selected_version: number;
  script_version_id: number;
  source_path: string;
  metadata: Record<string, unknown>;
  public_score?: number;
  versions: VersionInfo[];
  already_existed: boolean;
}

export interface ArchiveStats {
  total_archives: number;
  unique_competitions: number;
  unique_kernels: number;
  harvest_root: string;
  total_size_bytes: number;
  disk_free_bytes: number;
  disk_total_bytes: number;
  disk_used_percent: number;
  min_free_bytes: number;
  low_disk_space: boolean;
}

export interface ActiveCompetitionInfo {
  competition: string;
  source: 'pinned' | 'auto' | 'env' | 'fallback';
  is_pinned: boolean;
  pinned_competition?: string | null;
}

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

export interface KernelCacheInfo {
  state: 'HIT' | 'MISS' | 'REFRESH' | 'UPDATE' | 'STALE';
  age_seconds: number;
  fetched_at?: number;
  refresh_state: 'idle' | 'scheduled' | 'running' | 'failed';
  refreshing: boolean;
}

export interface KernelListResult {
  items: ScoredKernel[];
  cache: KernelCacheInfo;
}

export interface ArchiveFile {
  name: string;
  size_bytes: number;
  type: string;
}

export interface EnteredCompetition {
  id: string;
  title: string;
  category?: string;
  deadline?: string;
  reward?: string;
  team_count?: number;
  is_simulation?: boolean;
  tags?: string[];
}

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

export type WebhookFormat = 'generic' | 'slack' | 'feishu' | 'dingtalk' | 'wecom' | 'ntfy';
export type SmtpSecurity = 'starttls' | 'ssl' | 'none';

export interface NotificationConfig {
  notify_on_archive: boolean;
  notify_on_failure: boolean;
  notify_on_score: boolean;
  notify_on_simulation?: boolean;
  wechat_enabled?: boolean;
  webhook_enabled: boolean;
  webhook_format: WebhookFormat;
  email_enabled: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_security: SmtpSecurity;
  smtp_username: string;
  smtp_from: string;
  smtp_to: string[];
  webhook_configured: boolean;
  smtp_password_configured: boolean;
  secret_storage: 'windows_dpapi' | 'environment' | 'file' | 'session';
}

export interface NotificationConfigUpdate {
  notify_on_archive?: boolean;
  notify_on_failure?: boolean;
  notify_on_score?: boolean;
  notify_on_simulation?: boolean;
  wechat_enabled?: boolean;
  webhook_enabled?: boolean;
  webhook_format?: WebhookFormat;
  email_enabled?: boolean;
  smtp_host?: string;
  smtp_port?: number;
  smtp_security?: SmtpSecurity;
  smtp_username?: string;
  smtp_from?: string;
  smtp_to?: string[];
  webhook_url?: string;
  smtp_password?: string;
  clear_webhook_url?: boolean;
  clear_smtp_password?: boolean;
}

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

export interface SimulationEpisodeAgent {
  submission_id?: number;
  team_id?: number;
  team_name?: string;
  reward?: number;
  index: number;
  state?: string;
}

export interface SimulationEpisode {
  id: number;
  create_time?: string;
  end_time?: string;
  duration_seconds?: number;
  state: string;
  type?: string;
  agents: SimulationEpisodeAgent[];
  my_agent_index: number;
  my_submission_id: number;
  my_team_name: string;
  opponent_team_name: string;
  opponent_team_id?: number;
  opponent_submission_id?: number;
  result: 'win' | 'loss' | 'tie' | 'unknown';
  is_system_check?: boolean;
  reward?: number;
  score_delta?: number;
  opponent_score?: number;
  replay_url?: string;
}

export interface SimulationEpisodePageResponse {
  submission_id: number;
  total: number;
  offset: number;
  limit: number;
  episodes: SimulationEpisode[];
}

export interface SimulationRatingPoint {
  episode_id: number;
  game_number: number;
  timestamp?: string;
  score: number;
  score_delta?: number;
  is_system_check?: boolean;
  result: 'win' | 'loss' | 'tie' | 'unknown';
}

export interface SimulationAgentStats {
  submission_id: number;
  alias?: string;
  team_name: string;
  description?: string;
  file_name?: string;
  date?: string;
  date_submitted?: string;
  status?: string;
  public_score?: number;
  score?: number;
  public_score_display?: string;
  rank?: number;
  total_episodes: number;
  wins: number;
  losses: number;
  ties: number;
  system_checks: number;
  win_rate: number;
  medal_tier?: 'gold' | 'silver' | 'bronze' | 'none' | 'unknown';
  bronze_gap_score?: number;
  bronze_gap_rank?: number;
  tier_cushion_score?: number;
  next_tier_gap_score?: number;
  next_tier_name?: 'gold' | 'silver' | 'bronze';
  recent_episodes: SimulationEpisode[];
  rating_trajectory: SimulationRatingPoint[];
  last_updated?: string;
}

export interface SimulationMedalThresholds {
  total_teams: number;
  gold_cutoff_rank?: number;
  gold_cutoff_score?: number;
  silver_cutoff_rank?: number;
  silver_cutoff_score?: number;
  bronze_cutoff_rank?: number;
  bronze_cutoff_score?: number;
  bronze_percentile: number;
  updated_at?: string;
}

export interface SimulationHistoryPoint {
  timestamp: string;
  submission_id: number;
  alias?: string;
  score?: number;
  rank?: number;
  wins: number;
  losses: number;
  ties: number;
  win_rate: number;
  total_episodes: number;
  bronze_gap_score?: number;
}

export interface SimulationMonitorConfig {
  enabled: boolean;
  competition: string;
  target_submission_ids?: number[];
  submission_ids?: number[];
  submission_aliases?: Record<string, string>;
  interval_minutes: number;
  bronze_percentile: number;
  notify_on_new_matches?: boolean;
  notify_on_new_episodes?: boolean;
  notify_on_medal_change: boolean;
}

export interface SimulationClawbotStatus {
  enabled: boolean;
  is_online?: boolean;
  configured: boolean;
  provider?: string;
  model?: string;
  base_url?: string;
  gateway_url?: string;
  account_id?: string;
  error?: string;
  updated_at?: string;
}

export interface SimulationClawbotTestCandidate {
  target: string;
  reachable: boolean;
  latency_ms?: number;
  detail: string;
}

export interface SimulationClawbotTestResult {
  success: boolean;
  message: string;
  active_url?: string;
  latency_ms?: number;
  configured: boolean;
  config_file_found?: string;
  model?: string;
  provider?: string;
  candidates: SimulationClawbotTestCandidate[];
}

export interface SimulationMonitorStatus {
  running: boolean;
  scheduler_alive: boolean;
  enabled?: boolean;
  service_started_at?: string;
  scheduler_heartbeat_at?: string;
  last_checked_at?: string;
  next_run_at?: string;
  last_error?: string;
  competition: string;
  agents: SimulationAgentStats[];
  thresholds?: SimulationMedalThresholds;
  medal_thresholds?: SimulationMedalThresholds;
  total_tracked_episodes: number;
  new_episodes_this_run: number;
  history: SimulationHistoryPoint[];
  clawbot?: SimulationClawbotStatus;
}

export interface SimulationMonitorRunLog {
  id: string;
  trigger: 'scheduled' | 'manual';
  outcome: 'success' | 'partial' | 'failed';
  started_at: string;
  finished_at: string;
  duration_seconds: number;
  agent_count: number;
  total_episodes_found: number;
  new_episodes_found: number;
  error?: string;
  details_available: boolean;
}

export interface SimulationMonitorRunDetail {
  log: SimulationMonitorRunLog;
  agents: SimulationAgentStats[];
  thresholds?: SimulationMedalThresholds;
}

export interface SimulationMonitorSnapshot {
  config: SimulationMonitorConfig;
  status: SimulationMonitorStatus;
  logs: SimulationMonitorRunLog[];
}

export interface NotificationStatus {
  worker_alive: boolean;
  last_sent_at?: string;
  last_error?: string;
  last_event_id?: string;
  pending_count: number;
}

export interface NotificationSnapshot {
  config: NotificationConfig;
  status: NotificationStatus;
}

export interface NotificationChannelResult {
  channel: string;
  success: boolean;
  message: string;
}

export interface NotificationTestResult {
  success: boolean;
  channels: NotificationChannelResult[];
}
