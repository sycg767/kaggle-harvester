import React, { useMemo, useRef, useState } from 'react';
import { App as AntApp } from 'antd';
import {
  api,
  ApiError,
  type ArchiveEntry,
  type ScoredKernel,
  type VersionInfo,
} from '../../api';
import { archiveJobs, type ArchiveJobRequest } from '../../archiveJobs';
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
  setSelectedRowKeys,
  onCloseVersionModal,
}: UseKernelArchiveOptions) {
  const { message } = AntApp.useApp();

  const submissionRef = useRef<{ id: string; items: ArchiveJobRequest[] } | null>(null);
  const versionRequestRef = useRef(0);
  const [archiveSubmissionPending, setArchiveSubmissionPending] = useState(false);
  const [archiveContext, setArchiveContext] = useState<{ competition: string; direction: ScoreDirection | null }>({ competition, direction: confirmedDirection });
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
      if (archiveContext.direction === 'maximize') {
        return currentScore > bestScoreValue ? version : best;
      }
      return currentScore < bestScoreValue ? version : best;
    });
  }, [archiveLatestVersion, archiveVersions, archiveContext.direction]);

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
    submissionRef.current = null;
    setArchiveSubmissionPending(false);
    const versionRequest = ++versionRequestRef.current;
    setArchiveContext({ competition, direction: confirmedDirection });
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
        .then((data) => { if (versionRequest === versionRequestRef.current) setArchiveVersions(
          [...data.versions].sort((a, b) => b.version_number - a.version_number),
        ); })
        .catch((err) => { if (versionRequest === versionRequestRef.current) setArchiveVersionsError(
          err instanceof Error ? err.message : '版本列表读取失败。',
        ); })
        .finally(() => { if (versionRequest === versionRequestRef.current) setArchiveVersionsLoading(false); });
    } else {
      setArchiveVersionsLoading(false);
    }
  };

  const runArchive = async () => {
    const archiveDirection = archiveContext.direction;
    const competition = archiveContext.competition;
    if (!archiveDirection) {
      message.error('分数方向尚未确认，无法执行归档。');
      return;
    }
    setArchiveRunning(true);
    setArchiveCompleted(false);
    try {
      // Retain the ID after a timeout: retrying submission must not duplicate work.

      let version: number | undefined;
      if (archiveTargets.length === 1) {
        if (archiveVersionChoice.startsWith('version:')) version = Number(archiveVersionChoice.slice(8));
        else if (archiveVersionChoice === 'latest') version = archiveLatestVersion?.version_number;
      }
      submissionRef.current ||= { id: crypto.randomUUID(), items: archiveTargets.map(kernel => ({
        kernel_ref: kernel.ref, version, score_direction: archiveDirection,
        include_outputs: includeOutputs, competition,
      })) };
      setArchiveSubmissionPending(true);
      await archiveJobs.create(submissionRef.current.items, submissionRef.current.id);
      setArchiveSubmissionPending(false);
      setArchiveModalOpen(false);
      setSelectedRowKeys([]);
      window.dispatchEvent(new Event('harvester:archive-jobs-changed'));
      message.success('已提交后台归档任务。可离开页面，在任务列表查看进度或重试失败项。');
    } catch (err) {
      if (err instanceof ApiError && err.status && err.status < 500 && ![408, 429].includes(err.status)) {
        submissionRef.current = null; setArchiveSubmissionPending(false);
        message.error(err.message);
      } else {
        message.error('任务提交结果暂未确认；请查看后台任务，或用当前参数重试同一任务。');
      }
      window.dispatchEvent(new Event('harvester:archive-jobs-changed'));
    } finally {
      setArchiveRunning(false);
    }
  };

  return {
    archiveCompetition: archiveContext.competition,
    archiveSubmissionPending,
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
