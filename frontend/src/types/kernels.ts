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
