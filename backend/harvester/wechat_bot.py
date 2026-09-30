import os
import sys
import json
import re
import argparse
import math
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
    return '{:.1f}{}'.format(value, suffix) if _finite(value) else '未知'


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _score(agent):
    return agent.get('score') if agent.get('score') is not None else agent.get('public_score')


def _episode_line(episode):
    result = {'win': '胜', 'loss': '负', 'tie': '平'}.get(episode.get('result'), '结果未知')
    delta = episode.get('score_delta')
    delta_text = ' {:+.1f}分'.format(delta) if isinstance(delta, (int, float)) else ''
    stamp = format_beijing_time(episode.get('end_time') or episode.get('create_time'), True) or '时间未知'
    return '{} {} {}{}'.format(stamp, result, _name(episode.get('opponent_team_name') or '对手未知'), delta_text)


def _short_time(value, now):
    stamp = _parse_time(value)
    if not stamp:
        return '尚无记录'
    stamp = stamp.astimezone(timezone(timedelta(hours=8)))
    pattern = '%m-%d %H:%M' if stamp.year == now.astimezone(timezone(timedelta(hours=8))).year else '%Y-%m-%d %H:%M'
    return stamp.strftime(pattern)


def _format_compact(data, now=None):
    now = now or datetime.now(timezone.utc)
    status, config = data.get('status') or {}, data.get('config') or {}
    agents = status.get('agents') or []
    competition = config.get('competition') or status.get('competition') or '对战'
    title = '宝可梦对战' if competition == 'pokemon-tcg-ai-battle' else _name(competition)[:24]
    lines = ['📊 ' + title + '速览']
    flags = []
    if status.get('last_error'):
        flags.append('同步失败')
    dates = [_parse_time(a.get('last_updated')) for a in agents]
    dates = [d for d in dates if d] or [_parse_time(status.get('last_checked_at'))]
    dates = [d for d in dates if d]
    if dates and (now - min(dates)).total_seconds() > max(30, (config.get('interval_minutes') or 10) * 2) * 60:
        flags.append('旧数据')
    if status.get('running'):
        flags.append('刷新中')
    if not config.get('enabled', status.get('enabled', False)):
        flags.append('监控已停')
    if flags:
        lines.append('⚠️ ' + ' · '.join(flags))
    if not agents:
        lines.append('暂无战报，请先配置 Agent')
    for index, agent in enumerate(agents):
        label = _name(agent.get('alias') or 'Agent {}'.format(index + 1))[:24]
        medal = {'gold': '🥇', 'silver': '🥈', 'bronze': '🥉'}.get(agent.get('medal_tier'), '⚪')
        rank = agent.get('rank')
        rank_text = '第 {} 名'.format(rank) if isinstance(rank, int) and rank > 0 else '排名未知'
        lines.extend(['', '{} {}'.format(medal, label), '{} 分 · {}'.format(_number(_score(agent)), rank_text)])
        cushion, gap = agent.get('tier_cushion_score'), agent.get('bronze_gap_score')
        safety = '安全垫 未知'
        if isinstance(cushion, (int, float)):
            safety = '安全垫 {:+.1f}'.format(cushion)
        elif isinstance(gap, (int, float)):
            safety = '铜牌线差 {:+.1f}'.format(gap)
        games = sum(v for v in (agent.get('wins'), agent.get('losses'), agent.get('ties')) if isinstance(v, int))
        rate = _number(agent.get('win_rate'), '%') if games > 0 else '未知'
        lines.append('{} · 胜率 {}'.format(safety, rate))
        episodes = _recent(agent, 1)
        if episodes:
            ep = episodes[0]
            icon, outcome = {'win': ('🟢', '胜'), 'loss': ('🔴', '负'), 'tie': ('⚪', '平')}.get(ep.get('result'), ('❔', '结果未知'))
            delta = ep.get('score_delta')
            delta_text = ' {:+.1f}分'.format(delta) if isinstance(delta, (int, float)) else ''
            stamp = _short_time(ep.get('end_time') or ep.get('create_time'), now)
            parsed_stamp = _parse_time(ep.get('end_time') or ep.get('create_time'))
            if parsed_stamp:
                bj = timezone(timedelta(hours=8))
                stamp = stamp.split(' ')[-1] if parsed_stamp.astimezone(bj).date() == now.astimezone(bj).date() else stamp.split(' ')[0]
            lines.append('{} 最近{}{} · {}'.format(icon, outcome, delta_text, stamp))
        else:
            lines.append('最近：暂无对局')
    lines.extend(['', '🕒 检查 ' + _short_time(status.get('last_checked_at'), now)])
    return sanitize_plain_text('\n'.join(lines))


def _recent(agent, limit=5):
    items = [ep for ep in (agent.get('recent_episodes') or []) if not ep.get('is_system_check')]
    floor = datetime.min.replace(tzinfo=timezone.utc)
    return sorted(items, key=lambda ep: _parse_time(ep.get('end_time')) or _parse_time(ep.get('create_time')) or floor, reverse=True)[:limit]


def _label(agent, index, config):
    alias = (config.get('submission_aliases') or {}).get(str(agent.get('submission_id')))
    return _name(agent.get('alias') or alias or 'Agent {}'.format(index + 1))


def _context(data, now):
    status, config = data.get('status') or {}, data.get('config') or {}
    thresholds = status.get('thresholds') or status.get('medal_thresholds') or {}
    agents = status.get('agents') or []
    dates = [_parse_time(a.get('last_updated')) for a in agents]
    missing_dates = bool(agents) and any(d is None for d in dates)
    dates = [d for d in dates if d] or [_parse_time(status.get('last_checked_at'))]
    dates = [d for d in dates if d]
    stale = not dates or missing_dates or (now - min(dates)).total_seconds() > max(30, (config.get('interval_minutes') or 10) * 2) * 60
    threshold_date = _parse_time(thresholds.get('updated_at'))
    old_thresholds = not threshold_date or (now - threshold_date).total_seconds() > max(30, (config.get('interval_minutes') or 10) * 2) * 60
    flags = []
    if status.get('last_error'): flags.append('同步失败')
    if stale: flags.append('旧数据' if dates and not missing_dates else '采集时间未知')
    if status.get('running'): flags.append('刷新中')
    if not config.get('enabled', status.get('enabled', False)): flags.append('监控已停')
    return status, config, thresholds, agents, flags, stale, old_thresholds


def _goal(agent, thresholds):
    score = _score(agent)
    if not _finite(score): return None
    options = [(thresholds.get(name + '_cutoff_score'), label) for name, label in [('bronze', '铜牌'), ('silver', '银牌'), ('gold', '金牌')]]
    above = [(value - score, label) for value, label in options if _finite(value) and value > score]
    return min(above) if above else None


def _five_results(episodes):
    icons = {'win': '🟢', 'loss': '🔴', 'tie': '⚪'}
    counts = [(key, label) for key, label in [('win', '胜'), ('loss', '负'), ('tie', '平')]]
    text = ' '.join('{} {}'.format(sum(ep.get('result') == key for ep in episodes), label) for key, label in counts if any(ep.get('result') == key for ep in episodes))
    unknown = sum(ep.get('result') not in icons for ep in episodes)
    if unknown: text += (' ' if text else '') + '{} 场未定'.format(unknown)
    return ''.join(icons.get(ep.get('result'), '❔') for ep in episodes), text or '暂无已记录对局'


def help_text():
    return ('👋 想看什么？\n\n'
            '战况：完整战报与简短点评\n排名 / 分数：快速看积分和名次\n奖牌线：各档门槛与差距\n'
            '流水：最近五场，按新到旧排列\n详情：完整日期、战绩和对手\n分析：只看基于近期数据的点评\n'
            '速览：极简指标卡\n刷新：执行一次真实同步\n走势图：发送趋势图\n\n'
            '普通查询读取已有快照；只有“刷新”触发同步。')


def _format_story(data, view='report', limit=5, now=None):
    now = now or datetime.now(timezone.utc)
    status, config, thresholds, agents, flags, stale, old_thresholds = _context(data, now)
    labels = [_label(a, i, config) for i, a in enumerate(agents)]
    goals = [_goal(a, thresholds) for a in agents]
    candidates = [(goal[0], i) for i, goal in enumerate(goals) if goal]
    focus = min(candidates)[1] if candidates and not (stale or old_thresholds or status.get('last_error')) else None
    title = {'ranking': '📍 积分与排名', 'medals': '🏁 奖牌门槛', 'history': '🎮 最近对局', 'analysis': '💬 这一轮怎么看？'}.get(view, '📣 战报来了' if not stale else '📋 战报快照')
    if view == 'report' and focus is not None:
        title += '｜{} 距{} {} 分'.format(labels[focus], goals[focus][1], _number(goals[focus][0]))
    competition = config.get('competition') or status.get('competition') or '赛事未配置'
    competition = '宝可梦对战' if competition == 'pokemon-tcg-ai-battle' else _name(competition)
    lines = [title, competition]
    if flags: lines.append('⚠️ ' + ' · '.join(flags))
    if view == 'ranking' and old_thresholds: lines.append('奖牌线较旧或未更新，差距仅供快照对照。')
    if not agents and view != 'medals':
        lines.extend(['', '暂无战报，请先在网页配置 Agent，再发送“刷新”。', '🕒 检查 ' + _short_time(status.get('last_checked_at'), now)])
        return sanitize_plain_text('\n'.join(lines))
    if view in ('report', 'ranking', 'history'):
        order = list(range(len(agents)))
        if view == 'ranking':
            order.sort(key=lambda i: agents[i].get('rank') if isinstance(agents[i].get('rank'), int) and not isinstance(agents[i].get('rank'), bool) and agents[i]['rank'] > 0 else float('inf'))
        for i in order:
            agent = agents[i]
            recent = _recent(agent, max(1, min(15, limit)) if view == 'history' else 5)
            icons, record = _five_results(recent)
            tier = {'gold': '🥇', 'silver': '🥈', 'bronze': '🥉'}.get(agent.get('medal_tier'), '⚪')
            heading = '{}【{}】'.format('🔥' if i == focus and goals[i][0] <= 5 else tier, labels[i])
            if view == 'history':
                lines.extend(['', heading + ' 最近 {} 场'.format(len(recent)), icons + '  ' + record])
                lines.extend(_episode_line(ep) for ep in recent)
                continue
            if goals[i]: heading += ' 距{} {} 分'.format(goals[i][1], _number(goals[i][0]))
            rank = agent.get('rank')
            rank_text = '第 {} 名'.format(rank) if isinstance(rank, int) and not isinstance(rank, bool) and rank > 0 else '排名未知'
            lines.extend(['', heading, '{} 分 · {} · {}'.format(_number(_score(agent)), rank_text, {'gold':'金牌区','silver':'银牌区','bronze':'铜牌区','none':'未达奖牌线'}.get(agent.get('medal_tier'),'奖牌状态未知'))])
            bronze = thresholds.get('bronze_cutoff_score')
            gap = _score(agent) - bronze if _finite(_score(agent)) and _finite(bronze) else agent.get('bronze_gap_score')
            cushion = '铜牌余量 {:+.1f} 分'.format(gap) if _finite(gap) else '铜牌余量未知'
            total = sum(v for v in (agent.get('wins'), agent.get('losses'), agent.get('ties')) if _finite(v))
            rate = _number(agent.get('wins') / total * 100, '%') if total and _finite(agent.get('wins')) else '未知'
            lines.append(cushion + '｜已结算胜率 ' + rate)
            if view == 'report':
                lines.append('近 {} 场：{}  {}'.format(len(recent), icons, record))
                if recent:
                    ep = recent[0]
                    verb = {'win':'胜','loss':'负','tie':'平'}.get(ep.get('result'),'结果未定')
                    delta = '，{:+.1f} 分'.format(ep['score_delta']) if _finite(ep.get('score_delta')) else ''
                    stamp = _short_time(ep.get('end_time') or ep.get('create_time'), now)
                    lines.append('最近记录：{} {}{}（{}）'.format(verb, _name(ep.get('opponent_team_name') or '对手未知'), delta, stamp))
    if view in ('report', 'medals'):
        teams = thresholds.get('total_teams')
        lines.extend(['', '🏁 奖牌门槛' + ('｜{} 支队伍'.format(teams) if isinstance(teams, int) and teams > 0 else '')])
        lines.append('　'.join('{} {}'.format(icon, _number(thresholds.get(key + '_cutoff_score'))) for key, icon in [('gold','🥇'),('silver','🥈'),('bronze','🥉')]))
        if old_thresholds: lines.append('门槛采集时间较旧或未知，差距仅供快照对照。')
        if view == 'medals':
            for i, goal in enumerate(goals):
                lines.append('{}：{}'.format(labels[i], '距{} {} 分'.format(goal[1], _number(goal[0])) if goal else '下一档差距暂无可靠数据'))
    if view in ('report', 'analysis') and agents:
        if view == 'report': lines.extend(['', '💬 这一轮怎么看？'])
        if stale or status.get('last_error'):
            lines.append('先别用这份旧记录判断当前走势，刷新后再看冲牌机会。')
        for i, agent in enumerate(agents):
            recent = _recent(agent, 5)
            _, record = _five_results(recent)
            if not recent: lines.append('{} 暂无对局记录，先积累样本。'.format(labels[i])); continue
            sentence = '{} 最近 {} 场，{}。'.format(labels[i], len(recent), record)
            if i == focus:
                sentence += '离{}还差 {} 分，下一场重点看积分变化，也留意门槛有没有上移。'.format(goals[i][1], _number(goals[i][0]))
            elif not stale:
                sentence += '别让单场输赢带跑判断，接着看后续几局。'
            lines.append(sentence)
        if focus is not None: lines.append('👀 这轮优先关注 {} 的变化。'.format(labels[focus]))
    if view in ('report', 'history'): lines.extend(['', '🟢胜 🔴负 ⚪平 ❔未定 · 新→旧'])
    lines.append('🕒 检查 ' + _short_time(status.get('last_checked_at'), now))
    return sanitize_plain_text('\n'.join(lines))


def format_message(data, history_only=False, limit=5, now=None, details=False, view='report', brief=False):
    if brief: return _format_compact(data, now)
    if not details:
        return _format_story(data, 'history' if history_only else view, limit, now)
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
        episodes = _recent(agent, limit if history_only else 5)
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


def get_status_text(history_only=False, refresh=False, limit=5, details=False, view='report', brief=False):
    if view == 'help': return help_text()
    data = _fetch_snapshot(refresh=refresh)
    return ('✅ 本次同步已完成\n' if refresh else '') + format_message(data, history_only=history_only, limit=limit, details=details, view=view, brief=brief)


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
    parser.add_argument('--details', action='store_true')
    parser.add_argument('--brief', action='store_true')
    views = parser.add_mutually_exclusive_group()
    for flag, value in [('ranking', 'ranking'), ('medals', 'medals'), ('analysis', 'analysis'), ('help-text', 'help')]:
        views.add_argument('--' + flag, dest='view', action='store_const', const=value)
    parser.set_defaults(view='report')
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
            print(get_status_text(args.history_only, args.refresh, args.limit, args.details, args.view, args.brief))
            if args.with_chart:
                print('\nMEDIA:' + get_chart_image())
    except Exception as exc:
        print('⚠️ 这次没能完成\n{}\n稍后可重新查询；若提示已有检查，请先等待。'.format(str(exc)), file=sys.stderr)
        sys.exit(1)
