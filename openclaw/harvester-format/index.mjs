// A channel-scoped final output guard: prompts alone cannot enforce rendering.
export function plainText(value) {
  return String(value ?? '')
    .replace(/^\s*```[^\n]*$/gm, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1（$2）')
    .replace(/\*|`/g, '')
    .replace(/__([^\n]+?)__/g, '$1')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1$2')
    .replace(/~~([^\n]+?)~~/g, '$1')
    .replace(/^\s*\|?\s*:?-{3,}[^\n]*$/gm, '')
    .replace(/^\s*\|(.+)\|\s*$/gm, (_, row) => row.split('|').map(cell => cell.trim()).filter(Boolean).join(' · '))
    .replace(/\n{3,}/g, '\n\n').trim();
}

export default {
  id: 'harvester-wechat-format',
  register(api) {
    api.on('message_sending', (event, context) => {
      if (context?.channelId !== 'openclaw-weixin') return;
      return { content: plainText(event.content) };
    });
  },
};
