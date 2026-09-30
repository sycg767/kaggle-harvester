from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Optional

from ..models import SimulationEpisode, SimulationEpisodeAgent


class PersistentSimulationEpisodeStore:
    """基于 SQLite 的天梯对局流水持久化存储，支持多线程与增量断点续存。"""

    def __init__(self, harvest_root: str | Path) -> None:
        self._db_path = (
            Path(harvest_root).resolve() / "_cache" / "simulation_episodes.db"
        )
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._init_db()

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
                CREATE TABLE IF NOT EXISTS episodes (
                    id INTEGER PRIMARY KEY,
                    submission_id INTEGER NOT NULL,
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
                    agents_json TEXT
                );
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_sub_time
                ON episodes(submission_id, create_time ASC, id ASC);
            """)
            conn.commit()

    def upsert_episodes(self, episodes: list[SimulationEpisode]) -> int:
        if not episodes:
            return 0
        rows = []
        for ep in episodes:
            agents_json = json.dumps(
                [a.model_dump(mode="json") for a in ep.agents],
                ensure_ascii=False,
            )
            rows.append((
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
                    id, submission_id, create_time, end_time, duration_seconds,
                    state, type, my_agent_index, my_team_name, opponent_team_name,
                    opponent_team_id, opponent_submission_id, result, is_system_check,
                    reward, score_delta, opponent_score, replay_url, agents_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, rows)
            conn.commit()
        return len(rows)

    def get_episodes(
        self,
        submission_id: int,
        order: str = "ASC",
        limit: Optional[int] = None,
    ) -> list[SimulationEpisode]:
        order_clause = "DESC" if order.upper() == "DESC" else "ASC"
        limit_clause = f"LIMIT {int(limit)}" if limit is not None else ""
        query = f"""
            SELECT * FROM episodes
            WHERE submission_id = ?
            ORDER BY create_time {order_clause}, id {order_clause}
            {limit_clause}
        """
        with self._lock, self._get_connection() as conn:
            cursor = conn.execute(query, (int(submission_id),))
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

    def get_latest_episode_id(self, submission_id: int) -> Optional[int]:
        with self._lock, self._get_connection() as conn:
            cursor = conn.execute(
                "SELECT id FROM episodes WHERE submission_id = ? ORDER BY create_time DESC, id DESC LIMIT 1",
                (int(submission_id),),
            )
            row = cursor.fetchone()
            return int(row["id"]) if row else None

    def get_episode_count(self, submission_id: int) -> int:
        with self._lock, self._get_connection() as conn:
            cursor = conn.execute(
                "SELECT COUNT(*) as cnt FROM episodes WHERE submission_id = ?",
                (int(submission_id),),
            )
            row = cursor.fetchone()
            return int(row["cnt"]) if row else 0

    def stats(self) -> dict[str, Any]:
        with self._lock, self._get_connection() as conn:
            cursor = conn.execute(
                "SELECT COUNT(*) as total_count, COUNT(DISTINCT submission_id) as sub_count FROM episodes"
            )
            row = cursor.fetchone()
            total_count = int(row["total_count"]) if row else 0
            sub_count = int(row["sub_count"]) if row else 0
        return {
            "total_episodes_stored": total_count,
            "submissions_tracked": sub_count,
            "db_path": str(self._db_path),
            "db_bytes": self._db_path.stat().st_size if self._db_path.exists() else 0,
        }
