"""Request host-side WeChat delivery and require a platform acceptance receipt."""
import hashlib
import json
import os
from pathlib import Path
import time


def send(event, timeout=45.0):
    from ..wechat_bot import sanitize_plain_text
    root = Path(os.environ.get('HARVEST_ROOT', 'harvested_kernels')) / '_cache'
    try:
        health = json.loads((root / 'clawbot_health.json').read_text(encoding='utf-8'))
        from datetime import datetime, timezone
        stamp = datetime.fromisoformat(health['checked_at'].replace('Z', '+00:00'))
        fresh = 0 <= (datetime.now(timezone.utc) - stamp).total_seconds() <= 90
        if not fresh or not health.get('delivery_configured'):
            raise ValueError('unavailable')
    except (OSError, ValueError, KeyError, TypeError):
        raise RuntimeError('微信发送桥接未就绪，请检查宿主机服务与已绑定会话；未记录为成功。')
    text = sanitize_plain_text('%s\n\n%s' % (event.get('title') or 'Kaggle Harvester', event.get('text') or ''))
    if len(text) > 4000:
        raise RuntimeError('微信通知超过 4000 字符，请缩短内容；未发送。')
    event_id = str(event.get('id') or hashlib.sha256(json.dumps(event, sort_keys=True, ensure_ascii=False).encode()).hexdigest())
    key = hashlib.sha256(event_id.encode()).hexdigest()
    directory = root / 'wechat_outbox'
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / (key + '.json')
    result = directory / (key + '.result.json')
    payload = {'id': event_id, 'text': text, 'attempt': 0}
    write_request = not path.exists()
    if path.exists():
        existing = json.loads(path.read_text(encoding='utf-8'))
        if existing.get('id') != event_id or existing.get('text') != text:
            raise RuntimeError('同一微信事件标识对应不同内容，未重复发送。')
        payload['attempt'] = existing.get('attempt', 0)
        if result.exists():
            prior = json.loads(result.read_text(encoding='utf-8'))
            if prior.get('status') == 'failed' and prior.get('attempt', 0) == payload['attempt']:
                # Only a definitive rejection is eligible for the manager's bounded retry.
                payload['attempt'] += 1
                write_request = True
    if write_request:
        temp = directory / (key + '.request.tmp')
        with temp.open('w', encoding='utf-8') as handle:
            os.chmod(temp, 0o600)
            json.dump(payload, handle, ensure_ascii=False)
            handle.flush()
            os.fsync(handle.fileno())
        temp.replace(path)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if result.exists():
            receipt = json.loads(result.read_text(encoding='utf-8'))
            if receipt.get('attempt', 0) != payload['attempt']:
                time.sleep(0.25)
                continue
            if receipt.get('status') == 'accepted' and receipt.get('message_id'):
                return
            raise RuntimeError(receipt.get('error') or '微信平台未确认发送成功。')
        time.sleep(0.25)
    raise RuntimeError('等待微信发送回执超时；保留原任务，结果未知，未记录为成功。')
