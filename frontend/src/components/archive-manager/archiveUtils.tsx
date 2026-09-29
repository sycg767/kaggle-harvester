import React from 'react';
import type { ArchiveEntry } from '../../api';

export interface ArchiveMetadata {
  metadata?: Record<string, unknown>;
  input_sources?: {
    dataset_sources?: string[];
    kernel_sources?: string[];
    competition_sources?: string[];
  };
}

export const DetailField: React.FC<{
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}> = ({ label, children, wide = false }) => (
  <div className={`archive-detail-field${wide ? ' is-wide' : ''}`}>
    <span className="archive-detail-label">{label}</span>
    <div className="archive-detail-value">{children}</div>
  </div>
);

export const formatBytes = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
};

export const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
};

export const formatScore = (value?: number) => (
  value === undefined || value === null ? '—' : value.toFixed(4)
);

export const normalizeEnumLabel = (value: unknown, kind: 'language' | 'kernel') => {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!normalized) return '未记录';
  const languageLabels: Record<string, string> = {
    LANGUAGE_PYTHON: 'Python',
    PYTHON: 'Python',
    LANGUAGE_R: 'R',
    R: 'R',
    LANGUAGE_JULIA: 'Julia',
    JULIA: 'Julia',
  };
  const kernelLabels: Record<string, string> = {
    NOTEBOOK: 'Notebook',
    KERNEL_TYPE_NOTEBOOK: 'Notebook',
    SCRIPT: 'Script',
    KERNEL_TYPE_SCRIPT: 'Script',
    BATCH: '批处理',
    INTERACTIVE: '交互式',
  };
  const readable = normalized
    .replace(/^LANGUAGE_/, '')
    .replace(/^KERNEL_TYPE_/, '')
    .toLowerCase()
    .replace(/(^|_)([a-z])/g, (_, prefix, letter) => `${prefix ? ' ' : ''}${letter.toUpperCase()}`);
  return (kind === 'language' ? languageLabels : kernelLabels)[normalized] || readable;
};

export const metadataValue = (
  metadata: Record<string, unknown> | undefined,
  ...keys: string[]
) => keys.map((key) => metadata?.[key]).find((value) => value !== undefined && value !== null);

export const normalizeBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'enabled'].includes(normalized)) return true;
  if (['false', '0', 'no', 'disabled'].includes(normalized)) return false;
  return undefined;
};

export const normalizeMachineShape = (value: unknown) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  if (normalized.toLowerCase() === 'gpu') return 'GPU';
  if (normalized.toLowerCase() === 'cpu') return 'CPU';
  if (normalized.toLowerCase() === 'tpu') return 'TPU';
  return normalized;
};

export const sourceLink = (kind: 'dataset' | 'kernel' | 'competition', source: string) => {
  const normalized = source
    .replace(/^datasets\//, '')
    .replace(/^kernels\//, '')
    .replace(/^code\//, '')
    .replace(/^competitions\//, '');
  if (kind === 'dataset') return `https://www.kaggle.com/datasets/${normalized}`;
  if (kind === 'kernel') return `https://www.kaggle.com/code/${normalized}`;
  return `https://www.kaggle.com/competitions/${normalized}`;
};

export const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

export const exportArchiveListCsv = (archives: ArchiveEntry[]) => {
  const headers = ['ref', 'title', 'author', 'competition', 'version', 'public_score', 'archived_at', 'file_count', 'size_bytes', 'path'];
  const rows = archives.map((archive) => [
    archive.ref,
    archive.title,
    archive.author,
    archive.competition,
    archive.version_number,
    archive.public_score,
    archive.archived_at,
    archive.file_count,
    archive.size_bytes,
    archive.path,
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `kaggle-harvester-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
