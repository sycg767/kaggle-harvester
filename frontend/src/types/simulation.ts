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
  gateway_ok?: boolean | null;
  gateway_reachable?: boolean | null;
  wechat_configured?: boolean | null;
  wechat_running?: boolean | null;
  business_api_ok?: boolean | null;
  delivery_configured?: boolean | null;
  checked_at?: string | null;
  status_source?: 'host_snapshot' | 'stale' | 'unknown';
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
  status?: SimulationClawbotStatus;
}

export interface SimulationMonitorStatus {
  last_success_at?: string | null;
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
  competition?: string;
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

export interface SimulationArenaSnapshot {
  run_id?: string | null;
  competition: string;
  monitored_competition: string;
  source: 'current' | 'history' | 'empty';
  captured_at?: string | null;
  warning?: string | null;
  status: SimulationMonitorStatus;
}
