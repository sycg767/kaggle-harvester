from __future__ import annotations

import difflib
import json
from pathlib import Path


MAX_SOURCE_BYTES = 2 * 1024 * 1024
MAX_PREVIEW_CHARS = 200000


def preview_source(archiver, archive_id):
    if archiver.get_archive(archive_id) is None:
        raise KeyError(archive_id)
    path = archiver.get_archive_source_path(archive_id)
    if path is None:
        raise FileNotFoundError('归档没有源文件')
    # Resolve again: the fallback glob in older archives may return a symlink.
    path = path.resolve()
    root = archiver.get_archive_path(archive_id).resolve()
    if not path.is_relative_to(root):
        raise ValueError('源文件不在该归档目录内')
    with path.open('rb') as handle:
        raw = handle.read(MAX_SOURCE_BYTES + 1)
    if len(raw) > MAX_SOURCE_BYTES:
        raise OverflowError('源文件超过 2 MB，请下载后查看')
    content = raw.decode('utf-8-sig', errors='replace')
    if path.suffix.lower() == '.ipynb':
        notebook = json.loads(content)
        sections = []
        for index, cell in enumerate(notebook.get('cells', []), 1):
            if cell.get('cell_type') not in {'markdown', 'code', 'raw'}:
                continue
            source = cell.get('source', '')
            if isinstance(source, list):
                source = ''.join(part for part in source if isinstance(part, str))
            if isinstance(source, str):
                sections.append(f"[Cell {index} · {cell['cell_type']}]\n{source}")
        content = '\n\n'.join(sections)
    return {'archive_id': archive_id, 'filename': path.name,
            'content': content[:MAX_PREVIEW_CHARS], 'truncated': len(content) > MAX_PREVIEW_CHARS}


def compare_sources(archiver, archive_id, other_id):
    left, right = archiver.get_archive(archive_id), archiver.get_archive(other_id)
    if left is None or right is None:
        raise KeyError('归档不存在')
    if left.ref != right.ref or left.version_number == right.version_number:
        raise ValueError('只能比较同一个 Notebook 的不同归档版本')
    before, after = preview_source(archiver, archive_id), preview_source(archiver, other_id)
    # Bound pathological line counts in SequenceMatcher as well as response size.
    before_lines, after_lines = before['content'].splitlines(), after['content'].splitlines()
    lines = difflib.unified_diff(before_lines[:5000], after_lines[:5000],
                                 fromfile=f'{left.ref} v{left.version_number}',
                                 tofile=f'{right.ref} v{right.version_number}', lineterm='')
    chunks, size, cut = [], 0, False
    for line in lines:
        size += len(line) + 1
        if size > MAX_PREVIEW_CHARS:
            cut = True
            break
        chunks.append(line)
    return {'archive_id': archive_id, 'other_id': other_id, 'diff': '\n'.join(chunks),
            'truncated': cut or before['truncated'] or after['truncated'] or len(before_lines) > 5000 or len(after_lines) > 5000}
