import io
import math
from pathlib import Path

import matplotlib
matplotlib.use("Agg")  # Non-interactive headless backend
import matplotlib.pyplot as plt

# Configure fonts for crisp standard English rendering across all OS/Docker containers
plt.rcParams["font.sans-serif"] = [
    "DejaVu Sans",
    "Helvetica Neue",
    "Arial",
    "Liberation Sans",
    "sans-serif",
]
plt.rcParams["axes.unicode_minus"] = False

COLORS = ["#d14343", "#3478c5", "#8b5cf6", "#0f9d75", "#d97706"]


def _label_for_agent(agent_data, index):
    if agent_data.get("alias"):
        return str(agent_data["alias"])
    sub_id = int(str(agent_data.get("submission_id") or 0))
    if sub_id == 55565346:
        return "p46"
    if sub_id == 55555162:
        return "p31"
    raw = str(agent_data.get("description") or agent_data.get("file_name") or "").strip()
    if "p46" in raw.lower():
        return "p46"
    if "p31" in raw.lower() or "p3plus31" in raw.lower():
        return "p31"
    return "Agent #" + str(index + 1)


def _finite_number(value):
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _competition_title(snapshot_data):
    config = snapshot_data.get("config") or {}
    status = snapshot_data.get("status") or {}
    explicit = config.get("competition_title") or status.get("competition_title")
    if explicit:
        return str(explicit).strip()
    competition = str(
        config.get("competition")
        or status.get("competition")
        or "Simulation"
    ).strip()
    if competition == "pokemon-tcg-ai-battle":
        return "Pokémon TCG AI Battle"
    return competition or "Simulation"


def _nice_y_axis(minimum, maximum, target_count=6):
    if maximum <= minimum:
        rounded = round(minimum)
        return rounded - 50, rounded + 50, [rounded - 50, rounded, rounded + 50]
    raw_step = (maximum - minimum) / max(1, target_count - 1)
    magnitude = 10 ** math.floor(math.log10(raw_step))
    normalized = raw_step / magnitude
    if normalized <= 1.25:
        multiplier = 1
    elif normalized <= 2.2:
        multiplier = 2
    elif normalized <= 3.8:
        multiplier = 2.5
    elif normalized <= 7.0:
        multiplier = 5
    else:
        multiplier = 10
    step = max(1, round(multiplier * magnitude))
    y_min = math.floor(minimum / step) * step
    y_max = math.ceil(maximum / step) * step
    ticks = []
    value = y_min
    while value <= y_max + 1e-5:
        ticks.append(round(value, 6))
        value += step
    return y_min, y_max, ticks


def _integer_ticks(minimum, maximum, count=5):
    if maximum <= minimum:
        return [round(minimum)]
    raw_step = (maximum - minimum) / max(1, count - 1)
    magnitude = 10 ** math.floor(math.log10(raw_step))
    normalized = raw_step / magnitude
    if normalized <= 1:
        multiplier = 1
    elif normalized <= 2:
        multiplier = 2
    elif normalized <= 5:
        multiplier = 5
    else:
        multiplier = 10
    step = max(1, multiplier * magnitude)
    first = math.ceil(minimum / step) * step
    last = math.ceil(maximum / step) * step
    return [
        round(first + index * step, 6)
        for index in range(max(1, math.floor((last - first) / step) + 1))
    ]


def build_trajectory_chart_model(snapshot_data):
    """Build the same display model used by the current web trajectory chart."""
    status = snapshot_data.get("status") or {}
    agents = status.get("agents") or []
    thresholds = status.get("thresholds") or status.get("medal_thresholds") or {}
    cutoff_by_tier = {
        "gold": _finite_number(thresholds.get("gold_cutoff_score")),
        "silver": _finite_number(thresholds.get("silver_cutoff_score")),
        "bronze": _finite_number(thresholds.get("bronze_cutoff_score")),
    }
    all_x = []
    all_y = []
    series = []

    for index, agent in enumerate(agents):
        system_check_ids = {
            episode.get("id")
            for episode in (agent.get("recent_episodes") or [])
            if episode.get("is_system_check") is True
        }
        trajectory = [
            point
            for point in (agent.get("rating_trajectory") or [])
            if point.get("is_system_check") is not True
            and point.get("episode_id") not in system_check_ids
        ]
        if not trajectory:
            episodes = [
                episode
                for episode in (agent.get("recent_episodes") or [])
                if episode.get("is_system_check") is not True
            ]
            episodes.sort(
                key=lambda item: (
                    item.get("end_time") or item.get("create_time") or "",
                    item.get("id") or 0,
                )
            )
            final_score = _finite_number(
                agent.get("score")
                if agent.get("score") is not None
                else agent.get("public_score")
            )
            if final_score is not None and episodes:
                score_after = final_score
                reversed_points = []
                for game_number, episode in reversed(
                    list(enumerate(episodes, start=1))
                ):
                    reversed_points.append(
                        {
                            "episode_id": episode.get("id"),
                            "game_number": game_number,
                            "score": round(score_after, 1),
                        }
                    )
                    score_after = round(
                        score_after - float(episode.get("score_delta") or 0.0), 1
                    )
                trajectory = list(reversed(reversed_points))

        points = []
        for point_index, point in enumerate(
            sorted(trajectory, key=lambda item: int(item.get("game_number") or 0))
        ):
            score = _finite_number(point.get("score"))
            if score is None:
                continue
            game_number = int(point.get("game_number") or point_index + 1)
            points.append((game_number, score))
        if not points:
            continue

        x_values = [point[0] for point in points]
        y_values = [point[1] for point in points]
        all_x.extend(x_values)
        all_y.extend(y_values)
        system_checks = int(agent.get("system_checks") or 0)
        raw_total = int(agent.get("total_episodes") or 0)
        total_games = max(0, raw_total - system_checks) or x_values[-1]
        series.append(
            {
                "id": agent.get("submission_id"),
                "label": _label_for_agent(agent, index),
                "color": COLORS[index % len(COLORS)],
                "x": x_values,
                "y": y_values,
                "total_games": total_games,
            }
        )

    if not all_x:
        x_min, x_max, x_ticks = 0, 10, [0, 5, 10]
        y_min, y_max, y_ticks = 0, 100, [0, 50, 100]
    else:
        max_games = max(all_x + [item["total_games"] for item in series])
        x_padding = max(16, round(max_games * 0.08))
        x_min, x_max = 0, max(10, max_games + x_padding)
        x_ticks = _integer_ticks(x_min, x_max, 5)
        cutoff_values = [value for value in cutoff_by_tier.values() if value is not None]
        effective_min = min(all_y + cutoff_values)
        maximum = max(all_y + cutoff_values)
        y_min, y_max, y_ticks = _nice_y_axis(effective_min - 10, maximum + 15, 6)

    competition_title = _competition_title(snapshot_data)
    return {
        "competition_title": competition_title,
        "title": competition_title + " — Rating Progression",
        "series": series,
        "cutoffs": cutoff_by_tier,
        "x_min": x_min,
        "x_max": x_max,
        "x_ticks": x_ticks,
        "y_min": y_min,
        "y_max": y_max,
        "y_ticks": y_ticks,
    }


def render_trajectory_chart(snapshot_data, output_path=None, dpi=150):
    """
    根据 SimulationMonitor 快照数据，使用 Matplotlib 生成与前端 ScoreTrajectoryChart 1:1 风格的高清评分轨迹折线图。
    使用纯英文标签，完美适配任何 Docker 容器与无中文字体环境。
    """
    model = build_trajectory_chart_model(snapshot_data)
    series_list = model["series"]
    fig, ax = plt.subplots(figsize=(9.2, 4.0), dpi=dpi)
    fig.patch.set_facecolor("#ffffff")
    ax.set_facecolor("#ffffff")

    ax.set_xticks(model["x_ticks"])
    ax.set_xlim(model["x_min"], model["x_max"])
    ax.set_yticks(model["y_ticks"])
    ax.set_ylim(model["y_min"], model["y_max"])

    # 主标题（居中正式展示）
    ax.set_title(
        model["title"],
        fontsize=11.5,
        fontweight="bold",
        color="#0f172a",
        pad=14,
    )

    # 绘制背景网格（柔和淡化浅灰）
    ax.grid(True, linestyle="-", linewidth=0.6, color="#f1f5f9", zorder=1)
    ax.set_axisbelow(True)

    # Match the web chart's complete Gold / Silver / Bronze reference system.
    for tier, label, line_color, text_color in (
        ("gold", "Gold", "#eab308", "#a16207"),
        ("silver", "Silver", "#94a3b8", "#64748b"),
        ("bronze", "Bronze", "#d97706", "#d97706"),
    ):
        cutoff = model["cutoffs"][tier]
        if cutoff is None:
            continue
        ax.axhline(
            y=cutoff,
            color=line_color,
            linestyle="--",
            linewidth=1.2,
            alpha=0.85,
            zorder=2,
        )
        x_lims = ax.get_xlim()
        ax.text(
            x_lims[0] + (x_lims[1] - x_lims[0]) * 0.015,
            cutoff,
            "{} {:.1f}".format(label, cutoff),
            color=text_color,
            fontsize=8.8,
            fontweight="bold",
            va="center",
            zorder=4,
            bbox=dict(
                boxstyle="round,pad=0.25",
                facecolor="#ffffff",
                edgecolor=text_color,
                linewidth=0.8,
                alpha=0.95,
            ),
        )

    import matplotlib.patheffects as patheffects

    # 绘制各 Agent 折线（精细化 1.5px 线宽，去除 1000 局密集圆点叠加）
    legend_elements = []
    end_points = []
    for item in series_list:
        line, = ax.plot(
            item["x"],
            item["y"],
            color=item["color"],
            linewidth=1.5,
            solid_capstyle="round",
            zorder=3,
            label="{} · {} games".format(item["label"], item["total_games"]),
        )
        legend_elements.append(line)

        if item["x"] and item["y"]:
            end_points.append({
                "x": item["x"][-1],
                "y": item["y"][-1],
                "color": item["color"],
                "label": item["label"],
            })

    # 智能自适应空间感知避让算法（动态感知上下层级与相对位置）
    max_x_val = max([pt["x"] for pt in end_points]) if end_points else 0

    annot_items = []
    for pt in end_points:
        is_trailing = pt["x"] < (max_x_val - 6)
        # 评估与其他折线的相对垂直位置
        others = [other for other in end_points if other is not pt]
        is_higher = len(others) == 0 or all(pt["y"] >= other["y"] for other in others)

        if is_trailing:
            # 若处于上方则向上避让，若处于下方则向下避让
            if is_higher:
                xytext = [0, 8]
                va = "bottom"
                ha = "center"
            else:
                xytext = [0, -14]
                va = "top"
                ha = "center"
        else:
            # 最右侧活跃队伍：置于终点正右侧
            xytext = [7, 0]
            va = "center"
            ha = "left"

        annot_items.append({
            "pt": pt,
            "xytext": xytext,
            "va": va,
            "ha": ha,
            "target_y": pt["y"],
        })

    # 垂直包围盒重叠松弛迭代（应对局数相同、分差极近的情况）
    MIN_SCORE_GAP = 16.0
    for _ in range(10):
        changed = False
        for i in range(len(annot_items)):
            for j in range(i + 1, len(annot_items)):
                item_a = annot_items[i]
                item_b = annot_items[j]
                dx = abs(item_a["pt"]["x"] - item_b["pt"]["x"])
                if dx < 40:
                    dy = abs(item_a["target_y"] - item_b["target_y"])
                    if dy < MIN_SCORE_GAP:
                        overlap = MIN_SCORE_GAP - dy
                        if item_a["target_y"] >= item_b["target_y"]:
                            item_a["target_y"] += overlap / 2.0
                            item_b["target_y"] -= overlap / 2.0
                        else:
                            item_a["target_y"] -= overlap / 2.0
                            item_b["target_y"] += overlap / 2.0
                        changed = True
        if not changed:
            break

    for item in annot_items:
        pt = item["pt"]
        # 根据松弛后的目标 Y 调整 xytext
        offset_y = item["xytext"][1]
        if item["va"] == "center" and abs(item["target_y"] - pt["y"]) > 1.0:
            offset_y += (item["target_y"] - pt["y"]) * 0.8

        ax.annotate(
            "{:.1f}".format(pt["y"]),
            xy=(pt["x"], pt["y"]),
            xytext=(item["xytext"][0], offset_y),
            textcoords="offset points",
            fontsize=9.5,
            fontweight="bold",
            color=pt["color"],
            va=item["va"],
            ha=item["ha"],
            zorder=6,
            path_effects=[patheffects.withStroke(linewidth=3.5, foreground="#ffffff")],
        )

    # 美化坐标轴
    ax.spines["top"].set_color("#cbd5e1")
    ax.spines["right"].set_color("#cbd5e1")
    ax.spines["bottom"].set_color("#94a3b8")
    ax.spines["left"].set_color("#94a3b8")
    ax.spines["top"].set_visible(True)
    ax.spines["right"].set_visible(True)

    ax.tick_params(axis="both", which="both", colors="#64748b", labelsize=8.8)
    ax.set_xlabel("Games Played", fontsize=9.5, fontweight="bold", color="#475569", labelpad=6)
    ax.set_ylabel("Skill Rating", fontsize=9.5, fontweight="bold", color="#475569", labelpad=6)

    # 右下角精简图例
    if series_list:
        ax.legend(
            loc="lower right",
            frameon=True,
            facecolor="#ffffff",
            edgecolor="#e2e8f0",
            framealpha=0.92,
            fontsize=8.5,
            borderpad=0.5,
            handlelength=1.4,
        )

    plt.tight_layout()

    buf = io.BytesIO()
    plt.savefig(buf, format="png", dpi=dpi, bbox_inches="tight")
    plt.close(fig)
    png_bytes = buf.getvalue()

    if output_path:
        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(png_bytes)

    return png_bytes
