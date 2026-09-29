import React, { useMemo, useState } from 'react';
import { App as AntApp } from 'antd';
import {
  api,
  type ArchiveEntry,
  type ScoredKernel,
  type VersionInfo,
} from '../../api';
import { dispatchArchivesChanged } from '../../events';
import type { ScoreDirection } from '../../scoreDirection';
import { formatDate, type ArchiveVersionChoice } from './kernelUtils';

interface UseKernelArchiveOptions {
  confirmedDirection: ScoreDirection | null;
  competition: string;
  archives: ArchiveEntry[];
  setArchives: React.Dispatch<React.SetStateAction<ArchiveEntry[]>>;
  setSelectedRowKeys: React.Dispatch<React.SetStateAction<React.Key[]>>;
  onCloseVersionModal?: () => void;
}

export function useKernelArchive({
  confirmedDirection,
  competition,
  archives,
  setArchives,
  setSelectedRowKeys,
  onCloseVersionModal,
}: UseKernelArchiveOptions) {
  const { message } = AntApp.useApp();

  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [archiveTargets, setArchiveTargets] = useState<ScoredKernel[]>([]);
  const [archiveVersionChoice, setArchiveVersionChoice] = useState<ArchiveVersionChoice>('best');
  const [archiveVersions, setArchiveVersions] = useState<VersionInfo[]>([]);
  const [archiveVersionsLoading, setArchiveVersionsLoading] = useState(false);
  const [archiveVersionsError, setArchiveVersionsError] = useState<string | null>(null);
  const [includeOutputs, setIncludeOutputs] = useState(false);
  const [archiveRunning, setArchiveRunning] = useState(false);
  const [archiveCompleted, setArchiveCompleted] = useState(false);
  const [archiveProgress, setArchiveProgress] = useState(0);
  const [archiveSuccesses, setArchiveSuccesses] = useState(0);
  const [archiveFailures, setArchiveFailures] = useState<string[]>([]);

  const archiveLatestVersion = useMemo(
    () => archiveVersions.reduce<VersionInfo | null>(
      (latest, version) => !latest || version.version_number > latest.version_number ? version : latest,
      null,
    ),
    [archiveVersions],
  );

  const archiveBestVersion = useMemo(() => {
    const scored = archiveVersions.filter(
      (version) => version.public_lb_numeric !== undefined && version.public_lb_numeric !== null,
    );
    if (!scored.length) return archiveLatestVersion;
    return scored.reduce((best, version) => {
      const bestScoreValue = best.public_lb_numeric as number;
      const currentScore = version.public_lb_numeric as number;
      if (confirmedDirection === 'maximize') {
        return currentScore > bestScoreValue ? version : best;
      }
      return currentScore < bestScoreValue ? version : best;
    });
  }, [archiveLatestVersion, archiveVersions, confirmedDirection]);

  const archiveVersionOptions = useMemo(() => {
    const versionLabel = (version: VersionInfo | null, fallback: string) => {
      if (!version) return fallback;
      const score = version.public_lb_numeric;
      return `${fallback} · v${version.version_number}${score === undefined || score === null ? ' · 暂无分数' : ` · ${score.toFixed(4)}`}`;
    };
    return [
      {
        label: '推荐',
        options: [
          { value: 'best', label: versionLabel(archiveBestVersion, '最佳分数版本') },
          ...(archiveLatestVersion
            ? [{ value: 'latest', label: versionLabel(archiveLatestVersion, '最新版本') }]
            : []),
        ],
      },
      ...(archiveVersions.length
        ? [{
          label: '所有历史版本',
          options: archiveVersions.map((version) => ({
            value: `version:${version.version_number}`,
            label: `v${version.version_number} · ${version.public_lb_numeric === undefined || version.public_lb_numeric === null ? '暂无分数' : version.public_lb_numeric.toFixed(4)} · ${formatDate(version.date_created)}`,
          })),
        }]
        : []),
    ];
  }, [archiveBestVersion, archiveLatestVersion, archiveVersions]);

  const openArchiveDialog = (targets: ScoredKernel[], version?: number) => {
    if (!targets.length) return;
    if (!confirmedDirection) {
      message.warning('请先确认该竞赛的分数方向，再选择最佳版本归档。');
      return;
    }
    if (version !== undefined && onCloseVersionModal) {
      onCloseVersionModal();
    }
    setArchiveTargets(targets);
    setArchiveVersionChoice(version === undefined ? 'best' : `version:${version}`);
    setArchiveVersions([]);
    setArchiveVersionsError(null);
    setIncludeOutputs(false);
    setArchiveRunning(false);
    setArchiveCompleted(false);
    setArchiveProgress(0);
    setArchiveSuccesses(0);
    setArchiveFailures([]);
    setArchiveModalOpen(true);

    if (targets.length === 1) {
      const [owner, slug] = targets[0].ref.split('/', 2);
      setArchiveVersionsLoading(true);
      void api.getKernelVersions(owner, slug, false)
        .then((data) => setArchiveVersions(
          [...data.versions].sort((a, b) => b.version_number - a.version_number),
        ))
        .catch((err) => setArchiveVersionsError(
          err instanceof Error ? err.message : '版本列表读取失败。',
        ))
        .finally(() => setArchiveVersionsLoading(false));
    } else {
      setArchiveVersionsLoading(false);
    }
  };

  const runArchive = async () => {
    const archiveDirection = confirmedDirection;
    if (!archiveDirection) {
      message.error('分数方向尚未确认，无法执行归档。');
      return;
    }
    setArchiveRunning(true);
    setArchiveCompleted(false);
    let successes = 0;
    const failures: string[] = [];

    for (let index = 0; index < archiveTargets.length; index += 1) {
      const kernel = archiveTargets[index];
      try {
        let selectedVersion: number | undefined;
        if (archiveTargets.length === 1) {
          if (archiveVersionChoice.startsWith('version:')) {
            selectedVersion = Number(archiveVersionChoice.slice('version:'.length));
          } else if (archiveVersionChoice === 'latest') {
            selectedVersion = archiveLatestVersion?.version_number;
          }
        }
        await api.archiveKernel({
          kernel_ref: kernel.ref,
          version: selectedVersion,
          score_direction: archiveDirection,
          include_outputs: includeOutputs,
          competition,
        });
        successes += 1;
      } catch (err) {
        failures.push(`${kernel.ref}：${err instanceof Error ? err.message : '未知错误'}`);
      }
      setArchiveSuccesses(successes);
      setArchiveFailures([...failures]);
      setArchiveProgress(Math.round(((index + 1) / archiveTargets.length) * 100));
    }

    setArchiveRunning(false);
    setArchiveCompleted(true);
    if (successes) {
      setArchives(await api.listArchives(competition).catch(() => archives));
      setSelectedRowKeys([]);
      dispatchArchivesChanged();
      message.success(`已完成 ${successes} 个归档`);
    }
  };

  return {
    archiveModalOpen,
    setArchiveModalOpen,
    archiveTargets,
    archiveVersionChoice,
    setArchiveVersionChoice,
    archiveVersionOptions,
    archiveVersionsLoading,
    archiveVersionsError,
    includeOutputs,
    setIncludeOutputs,
    archiveRunning,
    archiveCompleted,
    archiveProgress,
    archiveSuccesses,
    archiveFailures,
    openArchiveDialog,
    runArchive,
  };
}
