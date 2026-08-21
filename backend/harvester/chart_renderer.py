import io
from pathlib import Path
from typing import Any, Optional, Union

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


def render_trajectory_chart(snapshot_data, output_path=None, dpi=150):
    """
    根据 SimulationMonitor 快照数据，使用 Matplotlib 生成与前端 ScoreTrajectoryChart 1:1 风格的高清评分轨迹折线图。
    使用纯英文标签，完美适配任何 Docker 容器与无中文字体环境。
    """
    status = snapshot_data.get("status", {})
    agents = status.get("agents", [])
    thresholds = status.get("thresholds") or status.get("medal_thresholds") or {}

    silver_cutoff = thresholds.get("silver_cutoff_score")
    bronze_cutoff = thresholds.get("bronze_cutoff_score")

    fig, ax = plt.subplots(figsize=(9.2, 4.2), dpi=dpi)
    fig.patch.set_facecolor("#ffffff")
    ax.set_facecolor("#ffffff")

    # 提取各 Agent 的轨迹数据
    all_x = []
    all_y = []
    series_list = []

    for idx, agent in enumerate(agents):
        label = _label_for_agent(agent, idx)
        color = COLORS[idx % len(COLORS)]

        trajectory = agent.get("rating_trajectory") or []
        if not trajectory:
            # 回退通过 recent_episodes 推导
            episodes = list(agent.get("recent_episodes") or [])
            episodes.sort(key=lambda item: (item.get("end_time") or item.get("create_time") or "", item.get("id") or 0))
            final_score = agent.get("score") if agent.get("score") is not None else agent.get("public_score")
            if final_score is not None and episodes:
                cur = float(final_score)
                reversed_pts = []
                for g_idx, ep in reversed(list(enumerate(episodes, start=1))):
                    reversed_pts.append((g_idx, cur))
                    cur = round(cur - float(ep.get("score_delta") or 0.0), 1)
                trajectory = [{"game_number": pt[0], "score": pt[1]} for pt in reversed(reversed_pts)]

        if trajectory:
            pts = sorted(trajectory, key=lambda p: int(p.get("game_number", 0)))
            x_vals = [int(p.get("game_number", 0)) for p in pts]
            y_vals = [float(p.get("score", 0.0)) for p in pts]
            all_x.extend(x_vals)
            all_y.extend(y_vals)
            final_s = y_vals[-1] if y_vals else (agent.get("score") or agent.get("public_score") or 0.0)
            total_g = agent.get("total_episodes") or len(x_vals)
            series_list.append({
                "label": label,
                "color": color,
                "x": x_vals,
                "y": y_vals,
                "final_score": final_s,
                "total_games": total_g,
            })

    # 设置参考线与范围
    cutoff_vals = [v for v in [silver_cutoff, bronze_cutoff] if v is not None]
    if all_y or cutoff_vals:
        min_y = min(all_y + cutoff_vals) if (all_y or cutoff_vals) else 400
        max_y = max(all_y + cutoff_vals) if (all_y or cutoff_vals) else 1000
        y_padding = max(10, (max_y - min_y) * 0.15)
        ax.set_ylim(min_y - y_padding, max_y + y_padding)

    if all_x:
        min_x = min(all_x)
        max_x = max(all_x)
        x_padding_left = max(2, (max_x - min_x) * 0.03)
        x_padding_right = max(18, (max_x - min_x) * 0.09)
        ax.set_xlim(max(0, min_x - x_padding_left), max_x + x_padding_right)
    else:
        ax.set_xlim(0, 100)
        ax.set_ylim(400, 1000)

    # 绘制背景网格
    ax.grid(True, linestyle="-", linewidth=0.6, color="#f1f5f9", zorder=1)
    ax.set_axisbelow(True)

    # 绘制银牌线与铜牌线虚线 (带胶囊背景，避免与折线穿刺重叠)
    if silver_cutoff is not None:
        ax.axhline(
            y=silver_cutoff,
            color="#64748b",
            linestyle="--",
            linewidth=1.2,
            alpha=0.85,
            zorder=2,
        )
        x_lims = ax.get_xlim()
        ax.text(
            x_lims[0] + (x_lims[1] - x_lims[0]) * 0.015,
            silver_cutoff,
            "Silver {:.1f}".format(silver_cutoff),
            color="#64748b",
            fontsize=9.0,
            fontweight="bold",
            va="center",
            zorder=4,
            bbox=dict(boxstyle="round,pad=0.25", facecolor="#ffffff", edgecolor="#64748b", linewidth=0.8, alpha=0.95),
        )

    if bronze_cutoff is not None:
        ax.axhline(
            y=bronze_cutoff,
            color="#d97706",
            linestyle="--",
            linewidth=1.2,
            alpha=0.85,
            zorder=2,
        )
        x_lims = ax.get_xlim()
        ax.text(
            x_lims[0] + (x_lims[1] - x_lims[0]) * 0.015,
            bronze_cutoff,
            "Bronze {:.1f}".format(bronze_cutoff),
            color="#d97706",
            fontsize=9.0,
            fontweight="bold",
            va="center",
            zorder=4,
            bbox=dict(boxstyle="round,pad=0.25", facecolor="#ffffff", edgecolor="#d97706", linewidth=0.8, alpha=0.95),
        )

    import matplotlib.patheffects as patheffects

    # 绘制各 Agent 折线
    legend_elements = []
    end_points = []
    for item in series_list:
        line, = ax.plot(
            item["x"],
            item["y"],
            color=item["color"],
            linewidth=2.0,
            solid_capstyle="round",
            zorder=3,
            label="{} · {:.1f} ({} games)".format(item["label"], item["final_score"], item["total_games"]),
        )
        legend_elements.append(line)

        if item["x"] and item["y"]:
            end_points.append({
                "x": item["x"][-1],
                "y": item["y"][-1],
                "color": item["color"],
                "label": item["label"],
            })

    # 防重叠智能垂直偏移
    end_points.sort(key=lambda p: p["y"], reverse=True)
    y_offsets = [0] * len(end_points)
    for i in range(len(end_points) - 1):
        diff = end_points[i]["y"] - end_points[i + 1]["y"]
        if diff < 15:  # 两点垂直分差很近
            y_offsets[i] = 4
            y_offsets[i + 1] = -4

    for idx, pt in enumerate(end_points):
        ax.plot(pt["x"], pt["y"], marker="o", markersize=6, color=pt["color"], zorder=5)
        offset_y = y_offsets[idx] if idx < len(y_offsets) else 0
        ax.annotate(
            "{:.1f}".format(pt["y"]),
            xy=(pt["x"], pt["y"]),
            xytext=(pt["x"] + 3, pt["y"] + offset_y),
            fontsize=9.5,
            fontweight="bold",
            color=pt["color"],
            va="center",
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

    ax.tick_params(axis="both", which="both", colors="#64748b", labelsize=9)
    ax.set_xlabel("games played", fontsize=10, color="#475569", labelpad=6)
    ax.set_ylabel("rating", fontsize=10, color="#475569", labelpad=6)

    # 右下角图例
    if series_list:
        ax.legend(
            loc="lower right",
            frameon=True,
            facecolor="#ffffff",
            edgecolor="#cbd5e1",
            framealpha=0.95,
            fontsize=9,
            borderpad=0.6,
            handlelength=1.5,
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
