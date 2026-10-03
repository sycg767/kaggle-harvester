from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Optional

from ..models import SimulationEpisode, SimulationEpisodeAgent


class PersistentSimulationEpisodeStore:
    """赛事隔离的 SQLite 天梯对局流水存储。

    The old cache used ``submission_id`` as its primary key and therefore could
    mix the same submission number across competitions.  The v2 database keeps
    the old file untouched and migrates it once using run-history evidence.
    """

    DEFAULT_COMPETITION = "pokemon-tcg-ai-battle"
    UNCLASSIFIED_COMPETITION = "__unclassified__"

    def __init__(self, harvest_root: str | Path) -> None:
        self._cache_root = Path(harvest_root).resolve() / "_cache"
        self._legacy_db_path = self._cache_root / "simulation_episodes.db"
        self._db_path = self._cache_root / "simulation_episodes_v2.db"
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._init_db()
        self._migrate_legacy_db()

    @contextmanager
    def _get_connection(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(str(self._db_path), timeout=30.0)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("PRAGMA synchronous=NORMAL;")
            yield conn
        finally:
            conn.close()

    def _init_db(self) -> None:
        with self._lock, self._get_connection() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS schema_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS episodes (
                    competition_slug TEXT NOT NULL,
                    submission_id INTEGER NOT NULL,
                    id INTEGER NOT NULL,
                    create_time TEXT,
                    end_time TEXT,
                    duration_seconds REAL,
                    state TEXT,
                    type TEXT,
                    my_agent_index INTEGER,
                    my_team_name TEXT,
                    opponent_team_name TEXT,
                    opponent_team_id INTEGER,
                    opponent_submission_id INTEGER,
                    result TEXT,
                    is_system_check INTEGER,
                    reward REAL,
                    score_delta REAL,
                    opponent_score REAL,
                    replay_url TEXT,
                    agents_json TEXT,
                    PRIMARY KEY (competition_slug, submission_id, id)
                );
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS competitions (
                    slug TEXT PRIMARY KEY,
                    title TEXT NOT NULL DEFAULT '',
                    lifecycle TEXT NOT NULL DEFAULT 'unknown',
                    deadline TEXT,
                    frozen_at TEXT,
                    updated_at TEXT NOT NULL
                );
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS competition_submissions (
                    competition_slug TEXT NOT NULL,
                    submission_id INTEGER NOT NULL,
                    alias TEXT,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    PRIMARY KEY (competition_slug, submission_id)
                );
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS monitor_configs (
                    competition_slug TEXT PRIMARY KEY,
                    enabled INTEGER NOT NULL DEFAULT 0,
                    interval_minutes INTEGER NOT NULL DEFAULT 10,
                    target_submission_ids_json TEXT NOT NULL DEFAULT '[]',
                    notify_on_change INTEGER NOT NULL DEFAULT 1,
                    updated_at TEXT NOT NULL
                );
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS monitor_runs (
                    run_id TEXT PRIMARY KEY,
                    competition_slug TEXT NOT NULL,
                    trigger TEXT NOT NULL,
                    outcome TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    finished_at TEXT NOT NULL,
                    total_episodes INTEGER NOT NULL DEFAULT 0,
                    error TEXT
                );
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS run_agents (
                    run_id TEXT NOT NULL,
                    competition_slug TEXT NOT NULL,
                    submission_id INTEGER NOT NULL,
                    score REAL,
                    rank INTEGER,
                    wins INTEGER NOT NULL DEFAULT 0,
                    losses INTEGER NOT NULL DEFAULT 0,
                    ties INTEGER NOT NULL DEFAULT 0,
                    episode_count INTEGER NOT NULL DEFAULT 0,
                    medal_tier TEXT,
                    PRIMARY KEY (run_id, submission_id)
                );
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_comp_sub_time
                ON episodes(competition_slug, submission_id, create_time ASC, id ASC);
            """)
            conn.commit()

    def register_competition(
        self,
        competition: str,
        *,
        lifecycle: str = "unknown",
        deadline: str | None = None,
        frozen_at: str | None = None,
    ) -> None:
        slug = competition.strip() or self.UNCLASSIFIED_COMPETITION
        now = datetime.now(timezone.utc).isoformat()
        with self._lock, self._get_connection() as conn:
            conn.execute(
                """INSERT INTO competitions(slug, lifecycle, deadline, frozen_at, updated_at)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(slug) DO UPDATE SET lifecycle=excluded.lifecycle,
                   deadline=COALESCE(excluded.deadline, competitions.deadline),
                   frozen_at=COALESCE(excluded.frozen_at, competitions.frozen_at),
                   updated_at=excluded.updated_at""",
                (slug, lifecycle, deadline, frozen_at, now),
            )
            conn.commit()

    def register_monitor_run(self, log: Any, agents: list[Any]) -> None:
        self.register_competition(str(log.competition))
        with self._lock, self._get_connection() as conn:
            conn.execute(
                """INSERT OR REPLACE INTO monitor_runs
                   (run_id, competition_slug, trigger, outcome, started_at, finished_at, total_episodes, error)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (log.id, log.competition, log.trigger, log.outcome, log.started_at,
                 log.finished_at, log.total_episodes_found, log.error),
            )
            conn.executemany(
                """INSERT OR REPLACE INTO run_agents
                   (run_id, competition_slug, submission_id, score, rank, wins, losses, ties, episode_count, medal_tier)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                [
                    (log.id, log.competition, a.submission_id, a.score, a.rank,
                     a.wins, a.losses, a.ties, a.total_episodes, a.medal_tier)
                    for a in agents
                ],
            )
            conn.commit()

    def _migration_competition_map(self) -> dict[int, str]:
        """Infer a submission's competition from immutable monitor snapshots."""
        mapping: dict[int, set[str]] = {}
        runs_root = self._cache_root / "simulation_monitor_runs"
        if runs_root.exists():
            for path in runs_root.glob("[0-9a-f][0-9a-f]*.json"):
                try:
                    payload = json.loads(path.read_text(encoding="utf-8"))
                    log = payload.get("log") or {}
                    competition = str(log.get("competition") or "").strip()
                    if not competition:
                        continue
                    for agent in payload.get("agents") or []:
                        try:
                            sub_id = int(agent["submission_id"])
                        except (KeyError, TypeError, ValueError):
                            continue
                        mapping.setdefault(sub_id, set()).add(competition)
                except (OSError, ValueError, TypeError, json.JSONDecodeError):
                    continue
        return {
            sub_id: next(iter(comps)) if len(comps) == 1 else self.UNCLASSIFIED_COMPETITION
            for sub_id, comps in mapping.items()
        }

    def _migrate_legacy_db(self) -> None:
        """Copy the legacy cache once, preserving it as a read-only fallback."""
        if not self._legacy_db_path.exists() or self._legacy_db_path == self._db_path:
            return
        with self._lock, self._get_connection() as conn:
            marker = conn.execute(
                "SELECT value FROM schema_meta WHERE key = 'legacy_migration_v1'"
            ).fetchone()
            if marker:
                return
            try:
                legacy = sqlite3.connect(str(self._legacy_db_path), timeout=30.0)
                legacy.row_factory = sqlite3.Row
                columns = {
                    row["name"]
                    for row in legacy.execute("PRAGMA table_info(episodes)").fetchall()
                }
                if "submission_id" not in columns or "id" not in columns:
                    legacy.close()
                    conn.execute(
                        "INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)",
                        ("legacy_migration_v1", "invalid-schema"),
                    )
                    conn.commit()
                    return
                comp_map = self._migration_competition_map()
                rows = legacy.execute("SELECT * FROM episodes").fetchall()
                legacy.close()
            except (OSError, sqlite3.Error):
                return

            insert_columns = [
                "competition_slug", "submission_id", "id", "create_time", "end_time",
                "duration_seconds", "state", "type", "my_agent_index", "my_team_name",
                "opponent_team_name", "opponent_team_id", "opponent_submission_id",
                "result", "is_system_check", "reward", "score_delta", "opponent_score",
                "replay_url", "agents_json",
            ]
            values = []
            for row in rows:
                comp = comp_map.get(int(row["submission_id"]), self.UNCLASSIFIED_COMPETITION)
                values.append((comp,) + tuple(row[column] for column in insert_columns[1:]))
            if values:
                placeholders = ", ".join("?" for _ in insert_columns)
                conn.executemany(
                    f"INSERT OR IGNORE INTO episodes ({', '.join(insert_columns)}) VALUES ({placeholders})",
                    values,
                )
                now = datetime.now(timezone.utc).isoformat()
                conn.executemany(
                    "INSERT OR IGNORE INTO competitions(slug, lifecycle, updated_at) VALUES (?, 'unknown', ?)",
                    [(value[0], now) for value in values],
                )
            conn.execute(
                "INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)",
                ("legacy_migration_v1", str(len(values))),
            )
            conn.commit()

    def upsert_episodes(
        self,
        episodes: list[SimulationEpisode],
        competition: str = DEFAULT_COMPETITION,
    ) -> int:
        if not episodes:
            return 0
        self.register_competition(competition)
        rows = []
        for ep in episodes:
            agents_json = json.dumps(
                [a.model_dump(mode="json") for a in ep.agents],
                ensure_ascii=False,
            )
            rows.append((
                competition.strip() or self.UNCLASSIFIED_COMPETITION,
                ep.id,
                ep.my_submission_id,
                ep.create_time,
                ep.end_time,
                ep.duration_seconds,
                ep.state,
                ep.type,
                ep.my_agent_index,
                ep.my_team_name,
                ep.opponent_team_name,
                ep.opponent_team_id,
                ep.opponent_submission_id,
                ep.result,
                1 if ep.is_system_check else 0,
                ep.reward,
                ep.score_delta,
                ep.opponent_score,
                ep.replay_url,
                agents_json,
            ))
        with self._lock, self._get_connection() as conn:
            conn.executemany("""
                INSERT OR REPLACE INTO episodes (
                    competition_slug, id, submission_id, create_time, end_time, duration_seconds,
                    state, type, my_agent_index, my_team_name, opponent_team_name,
                    opponent_team_id, opponent_submission_id, result, is_system_check,
                    reward, score_delta, opponent_score, replay_url, agents_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, rows)
            conn.commit()
        return len(rows)

    def get_episodes(
        self,
        submission_id: int,
        order: str = "ASC",
        limit: Optional[int] = None,
        competition: str = DEFAULT_COMPETITION,
    ) -> list[SimulationEpisode]:
        order_clause = "DESC" if order.upper() == "DESC" else "ASC"
        limit_clause = f"LIMIT {int(limit)}" if limit is not None else ""
        query = f"""
            SELECT * FROM episodes
            WHERE competition_slug = ? AND submission_id = ?
            ORDER BY create_time {order_clause}, id {order_clause}
            {limit_clause}
        """
        with self._lock, self._get_connection() as conn:
            cursor = conn.execute(query, (competition.strip() or self.UNCLASSIFIED_COMPETITION, int(submission_id)))
            rows = cursor.fetchall()

        episodes: list[SimulationEpisode] = []
        for r in rows:
            agents_data: list[SimulationEpisodeAgent] = []
            if r["agents_json"]:
                try:
                    raw = json.loads(r["agents_json"])
                    agents_data = [SimulationEpisodeAgent(**item) for item in raw]
                except Exception:
                    agents_data = []
            outcome = r["result"] or "unknown"
            is_system_check = bool(r["is_system_check"])
            if not is_system_check and agents_data:
                my_sub = r["submission_id"]
                my_agent = next((a for a in agents_data if a.submission_id == my_sub), None)
                opponents = [a for a in agents_data if a.submission_id != my_sub]
                if my_agent and opponents:
                    my_rew = my_agent.reward
                    opp_rewards = [a.reward for a in opponents if a.reward is not None]
                    if my_rew is not None and opp_rewards:
                        opp_max = max(opp_rewards)
                        outcome = "win" if my_rew > opp_max else ("loss" if my_rew < opp_max else "tie")
                    elif r["score_delta"] is not None:
                        outcome = "win" if r["score_delta"] > 0 else ("loss" if r["score_delta"] < 0 else "tie")
                elif r["score_delta"] is not None:
                    outcome = "win" if r["score_delta"] > 0 else ("loss" if r["score_delta"] < 0 else "tie")
            elif not is_system_check and r["score_delta"] is not None:
                outcome = "win" if r["score_delta"] > 0 else ("loss" if r["score_delta"] < 0 else "tie")

            ep = SimulationEpisode(
                id=r["id"],
                create_time=r["create_time"],
                end_time=r["end_time"],
                duration_seconds=r["duration_seconds"],
                state=r["state"] or "",
                type=r["type"] or "",
                agents=agents_data,
                my_agent_index=r["my_agent_index"] or 0,
                my_submission_id=r["submission_id"],
                my_team_name=r["my_team_name"] or "",
                opponent_team_name=r["opponent_team_name"] or "",
                opponent_team_id=r["opponent_team_id"],
                opponent_submission_id=r["opponent_submission_id"],
                result=outcome,
                is_system_check=is_system_check,
                reward=r["reward"],
                score_delta=r["score_delta"],
                opponent_score=r["opponent_score"],
                replay_url=r["replay_url"] or "",
            )
            episodes.append(ep)
        return episodes

    def get_latest_episode_id(
        self, submission_id: int, competition: str = DEFAULT_COMPETITION
    ) -> Optional[int]:
        with self._lock, self._get_connection() as conn:
            cursor = conn.execute(
                "SELECT id FROM episodes WHERE competition_slug = ? AND submission_id = ? ORDER BY create_time DESC, id DESC LIMIT 1",
                (competition.strip() or self.UNCLASSIFIED_COMPETITION, int(submission_id)),
            )
            row = cursor.fetchone()
            return int(row["id"]) if row else None

    def get_episode_count(
        self, submission_id: int, competition: str = DEFAULT_COMPETITION
    ) -> int:
        with self._lock, self._get_connection() as conn:
            cursor = conn.execute(
                "SELECT COUNT(*) as cnt FROM episodes WHERE competition_slug = ? AND submission_id = ?",
                (competition.strip() or self.UNCLASSIFIED_COMPETITION, int(submission_id)),
            )
            row = cursor.fetchone()
            return int(row["cnt"]) if row else 0

    def stats(self) -> dict[str, Any]:
        with self._lock, self._get_connection() as conn:
            cursor = conn.execute(
                "SELECT COUNT(*) as total_count, COUNT(DISTINCT submission_id) as sub_count, COUNT(DISTINCT competition_slug) as competition_count FROM episodes"
            )
            row = cursor.fetchone()
            total_count = int(row["total_count"]) if row else 0
            sub_count = int(row["sub_count"]) if row else 0
            competition_count = int(row["competition_count"]) if row else 0
        return {
            "total_episodes_stored": total_count,
            "submissions_tracked": sub_count,
            "competitions_tracked": competition_count,
            "db_path": str(self._db_path),
            "db_bytes": self._db_path.stat().st_size if self._db_path.exists() else 0,
        }
