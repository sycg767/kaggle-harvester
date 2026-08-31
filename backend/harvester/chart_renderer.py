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

            # 若起点不是 0 局（例如首局为第 1 局或增量截取），补充 (0, 首局初始分) 锚点，确保折线平滑连接至原点 0
            if x_vals:
                if x_vals[0] > 0:
                    x_vals = [0] + x_vals
                    y_vals = [y_vals[0]] + y_vals

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

    # 设置参考线与范围（聚焦 600 分以上真实竞争区间，右侧留足标签留白）
    cutoff_vals = [v for v in [silver_cutoff, bronze_cutoff] if v is not None]
    if all_y or cutoff_vals:
        min_y = min(all_y + cutoff_vals) if (all_y or cutoff_vals) else 600.0
        max_y = max(all_y + cutoff_vals) if (all_y or cutoff_vals) else 1000.0
        effective_min = max(600.0, min_y)
        y_padding = max(10.0, (max_y - effective_min) * 0.12)
        ax.set_ylim(max(550.0, effective_min - y_padding), max_y + y_padding)

    if all_x:
        max_x = max(all_x)
        x_padding_right = max(70.0, max_x * 0.08)
        ax.set_xlim(0, max_x + x_padding_right)
    else:
        ax.set_xlim(0, 100)
        ax.set_ylim(600, 1000)

    # 主标题（居中正式展示）
    ax.set_title(
        "Pokémon TCG AI Battle — Final Submission Rating Progression",
        fontsize=11.5,
        fontweight="bold",
        color="#0f172a",
        pad=14,
    )

    # 绘制背景网格（柔和淡化浅灰）
    ax.grid(True, linestyle="-", linewidth=0.6, color="#f1f5f9", zorder=1)
    ax.set_axisbelow(True)

    # 绘制银牌线与铜牌线虚线 (左侧胶囊徽章参考体系)
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
            fontsize=8.8,
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
            fontsize=8.8,
            fontweight="bold",
            va="center",
            zorder=4,
            bbox=dict(boxstyle="round,pad=0.25", facecolor="#ffffff", edgecolor="#d97706", linewidth=0.8, alpha=0.95),
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
