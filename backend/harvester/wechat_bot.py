import os
import sys
import json
import re
import argparse
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent
repo_dir = backend_dir.parent


def load_config_value(name):
    value = os.getenv(name, '').strip()
    if value:
        return value
    for path in [Path.home() / '.openclaw' / 'kaggle-harvester.env',
                 Path.home() / '.openclaw' / 'runtime.env', repo_dir / '.env.deploy',
                 backend_dir / '.env', repo_dir / '.env']:
        try:
            with path.open(encoding='utf-8', errors='ignore') as stream:
                for line in stream:
                    if line.startswith(name + '='):
                        return line.split('=', 1)[1].strip().strip('\'"')
        except (IOError, OSError):
            pass
    return ''


def _headers():
    headers = {'User-Agent': 'KaggleHarvesterWechatBot/2.0'}
    key = load_config_value('HARVESTER_API_KEY')
    if key:
        headers['X-Harvester-Key'] = key
    return headers


def _monitor_url(url):
    url = url.rstrip('/')
    if url.endswith('/simulation-monitor'):
        return url
    return url + ('/simulation-monitor' if url.endswith('/api') else '/api/simulation-monitor')


def _resolve_api_url():
    configured = load_config_value('HARVESTER_API_URL')
    if configured:
        return _monitor_url(configured)
    port = load_config_value('APP_PORT')
    if port:
        return 'http://127.0.0.1:{}/api/simulation-monitor'.format(port)
    candidates = ['http://127.0.0.1:{}/api/simulation-monitor'.format(p) for p in (8080, 8000, 80)]
    for url in candidates:
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=_headers()), timeout=0.8) as response:
                if response.status == 200:
                    return url
        except Exception:
            pass
    return candidates[0]


def _fetch_snapshot(url=None, refresh=False):
    url = url or _resolve_api_url()
    try:
        if refresh:
            request = urllib.request.Request(url + '/run', data=b'', headers=_headers(), method='POST')
            with urllib.request.urlopen(request, timeout=90) as response:
                refreshed = json.loads(response.read().decode('utf-8'))
            error = (refreshed.get('status') or {}).get('last_error')
            if error:
                raise RuntimeError('本次同步未完成，请在网站查看检查日志；旧快照仍保留')
        request = urllib.request.Request(url, headers=_headers())
        with urllib.request.urlopen(request, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))
        if not isinstance(data, dict) or not isinstance(data.get('status'), dict):
            raise RuntimeError('战报接口返回格式不正确')
        return data
    except urllib.error.HTTPError as exc:
        if exc.code == 409:
            detail = '已有检查正在执行，请稍后查询'
        elif exc.code in (401, 403):
            detail = '访问验证失败，请检查助手的访问配置'
        else:
            detail = '后端返回 HTTP {}'.format(exc.code)
        raise RuntimeError(('刷新失败：' if refresh else '战报获取失败：') + detail)
    except (urllib.error.URLError, TimeoutError, OSError):
        raise RuntimeError('刷新请求超时或连接失败，可能仍在执行；请稍后查询，勿连续刷新' if refresh else '战报获取失败：无法访问战报服务，请检查后端状态')


def _parse_time(raw):
    if not raw:
        return None
    match = re.match(r'^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$', str(raw).strip())
    if not match:
        return None
    try:
        dt = datetime.strptime(match[1] + ' ' + match[2], '%Y-%m-%d %H:%M:%S')
        offset = match[3]
        minutes = 480
        if offset == 'Z':
            minutes = 0
        elif offset:
            digits = offset[1:].replace(':', '')
            minutes = (int(digits[:2]) * 60 + int(digits[2:])) * (1 if offset[0] == '+' else -1)
        return dt.replace(tzinfo=timezone(timedelta(minutes=minutes)))
    except ValueError:
        return None


def format_beijing_time(raw_time, include_date=False):
    dt = _parse_time(raw_time)
    return dt.astimezone(timezone(timedelta(hours=8))).strftime('%Y-%m-%d %H:%M' if include_date else '%H:%M') if dt else ''


def sanitize_plain_text(text):
    """Only remove display markup; retain scores, underscores and meaningful punctuation."""
    text = str(text).replace('\r\n', '\n')
    text = re.sub(r'^\s*```[^\n]*\n?', '', text, flags=re.M)
    text = re.sub(r'!\[([^\]]*)\]\(([^)]+)\)', r'\1（\2）', text)
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'\1（\2）', text)
    text = re.sub(r'^\s{0,3}#{1,6}\s+', '', text, flags=re.M)
    text = re.sub(r'^\s*>\s?', '', text, flags=re.M)
    text = re.sub(r'^\s*[*+-]\s+', '· ', text, flags=re.M)
    text = text.replace('**', '').replace('~~', '').replace('`', '')
    text = re.sub(r'(?<!\w)__([^\n]+?)__(?!\w)', r'\1', text)
    text = re.sub(r'(?<!\w)\*([^*\n]+)\*(?!\w)', r'\1', text)
    return text.strip()


def _name(value):
    return ' '.join(sanitize_plain_text(value).split())[:90]


def _number(value, suffix=''):
    return '{:.1f}{}'.format(value, suffix) if isinstance(value, (int, float)) and not isinstance(value, bool) else '未知'


def _score(agent):
    return agent.get('score') if agent.get('score') is not None else agent.get('public_score')


def _episode_line(episode):
    result = {'win': '胜', 'loss': '负', 'tie': '平'}.get(episode.get('result'), '结果未知')
    delta = episode.get('score_delta')
    delta_text = ' {:+.1f}分'.format(delta) if isinstance(delta, (int, float)) else ''
    stamp = format_beijing_time(episode.get('end_time') or episode.get('create_time'), True) or '时间未知'
    return '{} {} {}{}'.format(stamp, result, _name(episode.get('opponent_team_name') or '对手未知'), delta_text)


def format_message(data, history_only=False, limit=5, now=None):
    status, config = data.get('status') or {}, data.get('config') or {}
    agents = status.get('agents') or []
    competition = config.get('competition') or status.get('competition') or '赛事未配置'
    title = 'Pokemon TCG AI' if competition == 'pokemon-tcg-ai-battle' else _name(competition)
    ranked = [agent for agent in agents if isinstance(agent.get('rank'), int) and agent['rank'] > 0]
    if ranked:
        best = min(ranked, key=lambda agent: agent['rank'])
        headline = '快照最佳排名：第 {} 名，{} 分'.format(best['rank'], _number(_score(best)))
    else:
        headline = '已记录 {} 个 Agent，排名待确认'.format(len(agents)) if agents else '暂无战报，请先配置 Agent 并执行检查'
    lines = [title + (' · 对局流水' if history_only else ' · 战报'), headline]
    checked = status.get('last_checked_at')
    lines.append('最近检查：{}（北京时间）'.format(format_beijing_time(checked, True) or '尚无记录'))
    alerts = []
    if not config.get('enabled', status.get('enabled', False)):
        alerts.append('自动监控已停用')
    if status.get('running'):
        alerts.append('正在检查，以下为已保存快照')
    if status.get('last_error'):
        alerts.append('最近同步失败，以下可能为旧快照；请查看网站检查日志')
    dt = _parse_time(checked)
    now = now or datetime.now(timezone.utc)
    interval = config.get('interval_minutes') or 10
    sample_dates = [_parse_time(agent.get('last_updated')) for agent in agents]
    dates = [stamp for stamp in sample_dates if stamp is not None] or ([dt] if dt else [])
    if dates and (now - min(dates)).total_seconds() > max(30, interval * 2) * 60:
        alerts.append('快照已过期，请刷新后再判断')
    if alerts:
        lines.insert(1, '先看：' + '；'.join(alerts))
    for index, agent in enumerate(agents):
        label = _name(agent.get('alias') or 'Agent {}'.format(index + 1))
        episodes = agent.get('recent_episodes') or []
        lines.append('')
        if history_only:
            selected = episodes[:max(1, min(15, int(limit)))]
            lines.append('【{}】最近 {} 场'.format(label, len(selected)))
            lines.extend(_episode_line(ep) for ep in selected)
            if not selected:
                lines.append('暂无对局记录')
            continue
        rank = agent.get('rank')
        rank_text = '第 {} 名'.format(rank) if isinstance(rank, int) and rank > 0 else '排名未知'
        tier = {'gold': '金牌区', 'silver': '银牌区', 'bronze': '铜牌区', 'none': '未达奖牌线'}.get(agent.get('medal_tier'), '奖牌线未知')
        lines.append('【{}】{} 分 · {} · {}'.format(label, _number(_score(agent)), rank_text, tier))
        wins, losses, ties = (agent.get(key) for key in ('wins', 'losses', 'ties'))
        record = '{}胜 / {}负 / {}平'.format(*('未知' if value is None else value for value in (wins, losses, ties)))
        sampled = sum(value for value in (wins, losses, ties) if isinstance(value, int))
        rate = _number(agent.get('win_rate'), '%') if sampled else '暂无有效对局'
        updated = format_beijing_time(agent.get('last_updated'), True)
        cushion = agent.get('tier_cushion_score')
        gap = agent.get('bronze_gap_score')
        safety = ''
        if isinstance(cushion, (int, float)):
            safety = '安全垫 {:+.1f}分 · '.format(cushion)
        elif isinstance(gap, (int, float)):
            safety = '距铜牌线 {:+.1f}分 · '.format(gap)
        lines.append('{}胜率 {}（{}）'.format(safety, rate, record))
        lines.append('最近：' + (_episode_line(episodes[0]) if episodes else '暂无对局记录'))
    if not history_only and agents:
        lines.extend(['', '发送“流水”看最近对局，“刷新”重新检查，“走势图”看趋势。'])
    return sanitize_plain_text('\n'.join(lines))


def get_status_text(history_only=False, refresh=False, limit=5):
    data = _fetch_snapshot(refresh=refresh)
    return ('已完成一次检查。\n' if refresh else '') + format_message(data, history_only=history_only, limit=limit)


def get_chart_image(output_path=None):
    import tempfile
    path = Path(output_path) if output_path else Path(tempfile.gettempdir()) / 'simulation_trajectory.png'
    base_url = _resolve_api_url()
    try:
        request = urllib.request.Request(base_url + '/chart.png', headers=_headers())
        with urllib.request.urlopen(request, timeout=30) as response:
            content = response.read()
        if not content.startswith(b'\x89PNG\r\n\x1a\n'):
            raise ValueError('not PNG')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return str(path.resolve())
    except Exception:
        # Never instantiate a manager against a guessed data directory: that can create an empty state.
        data = _fetch_snapshot(base_url)
        try:
            if str(backend_dir) not in sys.path:
                sys.path.insert(0, str(backend_dir))
            from harvester.chart_renderer import render_trajectory_chart
            path.parent.mkdir(parents=True, exist_ok=True)
            render_trajectory_chart(data, output_path=path)
            return str(path.resolve())
        except Exception:
            raise RuntimeError('走势图生成失败：后端图表服务不可用，宿主机绘图依赖或 Python 版本不兼容；请检查后端日志')


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description='查询保存的对战快照，或主动刷新一次')
    parser.add_argument('--refresh', action='store_true')
    parser.add_argument('--history-only', '--only-history', action='store_true')
    parser.add_argument('--limit', type=int, choices=range(1, 16), default=5)
    parser.add_argument('--chart', '--image', '-c', '--pic', action='store_true')
    parser.add_argument('--with-chart', '--with-image', action='store_true')
    parser.add_argument('mode', nargs='?', choices=['chart', 'image', 'pic', '图', '走势', '轨迹', '曲线'])
    args = parser.parse_args()
    try:
        if args.chart or args.mode:
            if args.refresh:
                _fetch_snapshot(refresh=True)
            print('MEDIA:' + get_chart_image())
        else:
            print(get_status_text(args.history_only, args.refresh, args.limit))
            if args.with_chart:
                print('\nMEDIA:' + get_chart_image())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
