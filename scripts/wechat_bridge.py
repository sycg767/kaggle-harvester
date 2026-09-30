"""Host-only WeChat adapter. Python 3.6+, no exposed TCP listener.

Protocol matches installed @tencent-weixin/openclaw-weixin 2.4.6 api/api.ts
and messaging/send.ts. Bot credentials/context remain on the host. Outbound
requests never choose their own recipient; only the single QR-bound owner is used.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from urllib import request, error, parse


def now():
    return datetime.now(timezone.utc).isoformat()


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    with temp.open('w', encoding='utf-8') as out:
        os.chmod(str(temp), 0o600)
        json.dump(data, out, ensure_ascii=False)
        out.flush()
        os.fsync(out.fileno())
    temp.replace(path)


def json_output(text):
    decoder = json.JSONDecoder()
    for match in re.finditer(r'\{', text):
        try:
            obj, _ = decoder.raw_decode(text[match.start():])
            if isinstance(obj, dict) and 'channels' in obj:
                return obj
        except ValueError:
            pass
    raise ValueError('No gateway status JSON')


def recipient(home):
    root = home / '.openclaw' / 'openclaw-weixin'
    ids = read_json(root / 'accounts.json')
    if not isinstance(ids, list) or len(ids) != 1:
        raise ValueError('需要唯一已绑定微信账号；多个账号必须先明确收件目标')
    account = ids[0]
    if not isinstance(account, str) or not re.fullmatch(r'[A-Za-z0-9_.@-]+', account):
        raise ValueError('微信账号标识无效')
    data = read_json(root / 'accounts' / (account + '.json'))
    to = data.get('userId')
    tokens = read_json(root / 'accounts' / (account + '.context-tokens.json'))
    context = tokens.get(to)
    if not to or not context or not data.get('token'):
        raise ValueError('微信会话未就绪，请先在已绑定微信中给机器人发一条消息')
    return data, to, context


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def send_message(home, plugin, text, client_id):
    account, to, context = recipient(home)
    url = account.get('baseUrl') or 'https://ilinkai.weixin.qq.com'
    parsed = parse.urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname != 'ilinkai.weixin.qq.com' or parsed.username or parsed.password:
        raise ValueError('微信 API 地址不在允许的官方地址范围')
    pkg = read_json(plugin / 'package.json')
    parts = [int(x) for x in pkg['version'].split('.')[:3]]
    version = (parts[0] << 16) | (parts[1] << 8) | parts[2]
    headers = {'Content-Type': 'application/json', 'AuthorizationType': 'ilink_bot_token',
               'Authorization': 'Bearer ' + account['token'],
               'X-WECHAT-UIN': base64.b64encode(str(int.from_bytes(os.urandom(4), 'big')).encode()).decode(),
               'iLink-App-Id': str(pkg['ilink_appid']), 'iLink-App-ClientVersion': str(version)}
    body = {'msg': {'from_user_id': '', 'to_user_id': to, 'client_id': client_id,
                    'message_type': 2, 'message_state': 2,
                    'item_list': [{'type': 1, 'text_item': {'text': text}}], 'context_token': context},
            'base_info': {'channel_version': pkg['version'], 'bot_agent': 'OpenClaw'}}
    req = request.Request(url.rstrip('/') + '/ilink/bot/sendmessage',
                          data=json.dumps(body, ensure_ascii=False).encode(), headers=headers)
    with request.build_opener(NoRedirect()).open(req, timeout=15) as response:
        try:
            data = json.loads(response.read(65536))
        except ValueError:
            raise RuntimeError('微信回执格式未知')
    if not isinstance(data, dict) or 'ret' not in data:
        raise RuntimeError('微信未返回明确回执')
    if data.get('ret') != 0:
        # Do not expose server text, recipients, tokens or message content in errors.
        raise ValueError('微信平台未确认发送成功（ret=%s）' % data.get('ret', 'missing'))
    return {'status': 'accepted', 'message_id': client_id, 'accepted_at': now()}


def inspect_health(args, env):
    result = {'checked_at': now(), 'gateway_ok': False, 'wechat_configured': False,
              'wechat_running': False, 'business_api_ok': False, 'delivery_configured': False,
              'model': None, 'error': None}
    try:
        cmd = ['runuser', '-u', args.user, '--', 'env', 'HOME=' + str(args.home),
               args.node, args.cli, 'health', '--json', '--timeout', '8000']
        output = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                universal_newlines=True, timeout=20)
        data = json_output(output.stdout)
        result['gateway_ok'] = output.returncode == 0 and data.get('ok') is True
        channel = data.get('channels', {}).get('openclaw-weixin', {})
        accounts = channel.get('accounts', {})
        values = list(accounts.values()) if isinstance(accounts, dict) else accounts
        values = [channel] + (values if isinstance(values, list) else [])
        result['wechat_configured'] = any(v.get('configured') is True for v in values if isinstance(v, dict))
        result['wechat_running'] = any(v.get('running') is True for v in values if isinstance(v, dict))
        cfg = read_json(args.home / '.openclaw' / 'openclaw.json')
        result['model'] = cfg.get('agents', {}).get('defaults', {}).get('model', {}).get('primary')
    except Exception:
        result['error'] = '宿主机网关状态读取失败'
    try:
        base = args.api_url or 'http://127.0.0.1:%s/api' % env.get('APP_PORT', '8080')
        base = base.rstrip('/')
        if base.endswith('/simulation-monitor'):
            base = base[:-len('/simulation-monitor')]
        if not base.endswith('/api'):
            base += '/api'
        url = base + '/live'
        with request.urlopen(request.Request(url, headers={'X-Harvester-Key': env.get('HARVESTER_API_KEY', '')}), timeout=5) as response:
            result['business_api_ok'] = response.status == 200
    except Exception:
        result['error'] = '战报 API 访问失败'
    try:
        recipient(args.home)
        result['delivery_configured'] = True
    except Exception:
        pass
    return result


def process_one(path, args, sanitize, sender=send_message):
    key = path.stem
    if not re.fullmatch(r'[a-f0-9]{64}', key) or path.is_symlink() or path.stat().st_size > 65536:
        return
    response = path.with_suffix('.result.json')
    claim = path.with_suffix('.sending')
    try:
        job = read_json(path)
        attempt = job.get('attempt', 0)
        if not isinstance(attempt, int) or not 0 <= attempt <= 10000:
            return
        if response.exists() and read_json(response).get('attempt', 0) >= attempt:
            return
        if claim.exists() and read_json(claim).get('attempt', 0) >= attempt:
            write_json(response, {'status': 'uncertain', 'attempt': attempt, 'error': '上次发送中断，结果未知；为避免重复消息未自动重发'})
            return
        if hashlib.sha256(job['id'].encode()).hexdigest() != key:
            raise ValueError('任务标识不匹配')
        text = sanitize(job['text'])
        if not text or len(text) > 4000:
            raise ValueError('微信消息为空或超过 4000 字符')
        # An immutable claim protects against duplicate delivery after a timeout/crash.
        write_json(claim, {'started_at': now(), 'attempt': attempt})
        result = sender(args.home, args.plugin, text, 'harvester-' + key[:32])
    except error.HTTPError as exc:
        result = {'status': 'failed' if 400 <= exc.code < 500 else 'uncertain', 'error': '微信发送返回 HTTP %s' % exc.code}
    except ValueError as exc:
        result = {'status': 'failed', 'error': str(exc)[:200]}
    except Exception:
        result = {'status': 'uncertain', 'error': '微信发送未取得回执；结果未知，未自动重发'}
    result['attempt'] = locals().get('attempt', 0)
    write_json(response, result)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--home', type=Path, required=True)
    parser.add_argument('--user', required=True)
    parser.add_argument('--node', required=True)
    parser.add_argument('--cli', required=True)
    parser.add_argument('--env-file', type=Path, required=True)
    parser.add_argument('--api-url')
    parser.add_argument('--health-only', action='store_true')
    args = parser.parse_args()
    sys.path.insert(0, str(args.repo / 'scripts'))
    from setup_openclaw import read_env
    env = read_env(args.env_file)
    candidates = list((args.home / '.openclaw' / 'npm' / 'projects').glob('*/node_modules/@tencent-weixin/openclaw-weixin/package.json'))
    if len(candidates) != 1:
        raise RuntimeError('无法唯一识别已安装的微信插件')
    args.plugin = candidates[0].parent
    sys.path.insert(0, str(args.repo / 'backend'))
    from harvester.wechat_bot import sanitize_plain_text
    cache = args.repo / 'harvested_kernels' / '_cache'
    outbox = cache / 'wechat_outbox'
    outbox.mkdir(parents=True, exist_ok=True)
    heartbeat = 0
    while True:
        if time.monotonic() >= heartbeat:
            write_json(cache / 'clawbot_health.json', inspect_health(args, env))
            heartbeat = time.monotonic() + 30
        if args.health_only:
            return
        for path in sorted(outbox.glob('*.json')):
            if path.name.endswith('.result.json'):
                continue
            process_one(path, args, sanitize_plain_text)
            if time.monotonic() >= heartbeat:
                break
        time.sleep(1)


if __name__ == '__main__':
    main()
