import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  type ActiveCompetitionInfo,
  type ArchiveEntry,
  type CompetitionInfo,
  type EnteredCompetition,
  type KernelCacheInfo,
  type ScoredKernel,
} from '../../api';
import { getEnteredCompetitions } from '../../enteredCompetitionsCache';
import { resolveScoreDirection, type ScoreDirection } from '../../scoreDirection';
import {
  dispatchCompetitionChanged,
  dispatchDefaultCompetitionChanged,
  HARVESTER_EVENTS,
} from '../../events';
import {
  DEFAULT_COMPETITION,
  RECENT_COMPETITIONS_KEY,
  SCORE_SORT_BEST,
  isScoreSort,
  resolveApiScoreSort,
  readRecentCompetitions,
  waitForRefreshPoll,
} from './kernelUtils';

export function useKernelListState() {
  const requestControllerRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);

  const [competitionInput, setCompetitionInput] = useState(
    () => localStorage.getItem('harvester.competition') || DEFAULT_COMPETITION,
  );
  const [competition, setCompetition] = useState(
    () => localStorage.getItem('harvester.competition') || DEFAULT_COMPETITION,
  );
  const competitionRef = useRef(competition);
  const [recentCompetitions, setRecentCompetitions] = useState(() => {
    const current = localStorage.getItem('harvester.competition') || DEFAULT_COMPETITION;
    return [...new Set([current, DEFAULT_COMPETITION, ...readRecentCompetitions()])].slice(0, 8);
  });
  const [activeCompInfo, setActiveCompInfo] = useState<ActiveCompetitionInfo | null>(null);
  const [settingDefault, setSettingDefault] = useState(false);
  const [enteredCompetitions, setEnteredCompetitions] = useState<EnteredCompetition[]>([]);
  const [enteredLoading, setEnteredLoading] = useState(false);
  const [enteredError, setEnteredError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState(SCORE_SORT_BEST);
  const [pageSize, setPageSize] = useState(50);
  const [maxPages, setMaxPages] = useState(1);
  const [scoreLimit, setScoreLimit] = useState(50);
  const [kernels, setKernels] = useState<ScoredKernel[]>([]);
  const [archives, setArchives] = useState<ArchiveEntry[]>([]);
  const [competitionInfo, setCompetitionInfo] = useState<CompetitionInfo | null>(null);
  const [confirmedDirection, setConfirmedDirection] = useState<ScoreDirection | null>(null);
  const [loading, setLoading] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [cacheInfo, setCacheInfo] = useState<KernelCacheInfo | null>(null);
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false);
  const [appliedQuery, setAppliedQuery] = useState<{ sort: string; competition: string; pageSize: number; maxPages: number; scoreLimit: number } | null>(null);
  const queryPending = Boolean(appliedQuery && (
    appliedQuery.sort !== sortBy || appliedQuery.competition !== competitionInput.trim() ||
    !isScoreSort(sortBy) && (appliedQuery.pageSize !== pageSize || appliedQuery.maxPages !== maxPages || appliedQuery.scoreLimit !== scoreLimit)
  ));

  const loadKernels = useCallback(
    async (refresh = false, requestedCompetition?: string) => {
      const nextCompetition = (requestedCompetition ?? competitionInput).trim();
      if (!/^[a-z0-9][a-z0-9-]{2,119}$/i.test(nextCompetition)) {
        setError('竞赛标识格式无效，请使用 Kaggle URL 中的英文 slug。');
        return;
      }

      requestControllerRef.current?.abort();
      const controller = new AbortController();
      requestControllerRef.current = controller;
      const requestSequence = requestSequenceRef.current + 1;
      requestSequenceRef.current = requestSequence;
      setLoading(true);
      setBackgroundRefreshing(false);
      setError(null);
      setElapsedSeconds(0);
      const startedAt = Date.now();
      const timer = window.setInterval(
        () => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)),
        1000,
      );

      try {
        const scoreSorted = isScoreSort(sortBy);
        const comp = await api
          .getCompetition(nextCompetition, { signal: controller.signal })
          .catch(() => null);
        if (controller.signal.aborted || requestSequence !== requestSequenceRef.current) return;
        setCompetitionInfo(comp);
        const resolvedDirection = resolveScoreDirection(nextCompetition, comp);
        setConfirmedDirection(resolvedDirection.direction);
        const isLowerBetter = resolvedDirection.direction === 'minimize';
        const apiSortBy =
          scoreSorted && !resolvedDirection.direction
            ? 'hotness'
            : resolveApiScoreSort(sortBy, isLowerBetter);
        const queryParams = {
          competition: nextCompetition,
          sort_by: apiSortBy,
          page_size: scoreSorted ? 50 : pageSize,
          max_pages: scoreSorted ? 1 : maxPages,
          include_scores: true,
          score_limit: scoreSorted ? 50 : scoreLimit,
        };
        const result = await api.listKernels({
          ...queryParams,
          refresh,
          signal: controller.signal,
        });
        if (requestSequence !== requestSequenceRef.current) return;
        setKernels(result.items);
        setAppliedQuery({ sort: sortBy, competition: nextCompetition, pageSize, maxPages, scoreLimit });
        setCacheInfo(result.cache);
        setBackgroundRefreshing(result.cache.refreshing);
        competitionRef.current = nextCompetition;
        setCompetition(nextCompetition);
        setCompetitionInput(nextCompetition);
        localStorage.setItem('harvester.competition', nextCompetition);
        setRecentCompetitions((current) => {
          const next = [nextCompetition, ...current.filter((value) => value !== nextCompetition)].slice(
            0,
            8,
          );
          localStorage.setItem(RECENT_COMPETITIONS_KEY, JSON.stringify(next));
          return next;
        });

        const archiveData = await api
          .listArchives(nextCompetition, controller.signal)
          .catch(() => []);
        if (controller.signal.aborted || requestSequence !== requestSequenceRef.current) return;
        setArchives(archiveData);
        dispatchCompetitionChanged(nextCompetition);

        if (result.cache.refreshing) {
          void (async () => {
            try {
              for (let attempt = 0; attempt < 20; attempt += 1) {
                await waitForRefreshPoll(1_500, controller.signal);
                const refreshed = await api.listKernels({
                  ...queryParams,
                  signal: controller.signal,
                });
                if (requestSequence !== requestSequenceRef.current) return;
                setCacheInfo(refreshed.cache);
                setBackgroundRefreshing(refreshed.cache.refreshing);
                if (!refreshed.cache.refreshing && refreshed.cache.state !== 'STALE') {
                  setKernels(refreshed.items);
                  return;
                }
              }
              if (requestSequence === requestSequenceRef.current) {
                setBackgroundRefreshing(false);
              }
            } catch (pollError) {
              if (!(pollError instanceof DOMException && pollError.name === 'AbortError')) {
                setBackgroundRefreshing(false);
              }
            }
          })();
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Kernel 列表加载失败。');
      } finally {
        window.clearInterval(timer);
        if (requestSequence === requestSequenceRef.current) setLoading(false);
      }
    },
    [competitionInput, maxPages, pageSize, scoreLimit, sortBy],
  );

  const loadEnteredCompetitions = useCallback(async (refresh = false) => {
    setEnteredLoading(true);
    setEnteredError(null);
    try {
      const items = await getEnteredCompetitions({ refresh });
      setEnteredCompetitions(items);
      if (!items.length) {
        setEnteredError('未获取到已参加竞赛，可手输 slug 或点刷新。');
      }
    } catch (err) {
      setEnteredError(err instanceof Error ? err.message : '已参加竞赛列表读取失败。');
    } finally {
      setEnteredLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadKernels(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadEnteredCompetitions(false);
  }, [loadEnteredCompetitions]);

  useEffect(() => {
    let mounted = true;
    void api
      .getActiveCompetition()
      .then((info) => {
        if (mounted) setActiveCompInfo(info);
      })
      .catch(() => null);

    const handleDefaultChanged = () => {
      void api
        .getActiveCompetition()
        .then((info) => {
          if (mounted) setActiveCompInfo(info);
        })
        .catch(() => null);
    };
    window.addEventListener(HARVESTER_EVENTS.defaultCompetitionChanged, handleDefaultChanged);
    return () => {
      mounted = false;
      window.removeEventListener(HARVESTER_EVENTS.defaultCompetitionChanged, handleDefaultChanged);
    };
  }, []);

  useEffect(() => {
    const changed = (event: Event) => {
      const slug = (event as CustomEvent<string>).detail;
      if (!slug || slug === competitionRef.current) return;
      competitionRef.current = slug;
      setCompetitionInput(slug); setCompetition(slug);
      setKernels([]); setArchives([]); setCompetitionInfo(null); setCacheInfo(null); setAppliedQuery(null);
      void loadKernels(false, slug);
    };
    window.addEventListener(HARVESTER_EVENTS.competitionChanged, changed);
    return () => window.removeEventListener(HARVESTER_EVENTS.competitionChanged, changed);
  }, [loadKernels]);

  useEffect(() => () => requestControllerRef.current?.abort(), []);

  const togglePinActiveCompetition = useCallback(async () => {
    const targetComp = competition.trim();
    if (!targetComp) return { success: false, message: '未选定有效竞赛' };
    setSettingDefault(true);
    try {
      const isCurrentPinned = activeCompInfo?.competition === targetComp && activeCompInfo?.is_pinned;
      if (isCurrentPinned) {
        const res = await api.deleteActiveCompetition();
        setActiveCompInfo(res);
        dispatchDefaultCompetitionChanged(res.competition);
        return {
          success: true,
          message: `已恢复智能推荐默认赛事（当前智能推荐：${res.competition}）`,
        };
      } else {
        const res = await api.setActiveCompetition(targetComp);
        setActiveCompInfo(res);
        dispatchDefaultCompetitionChanged(res.competition);
        return {
          success: true,
          message: `已将「${competitionInfo?.title || targetComp}」设为全站主攻赛事，作为所有设备首次打开时的默认赛事；已有浏览器选择保持不变！`,
        };
      }
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : '设置默认竞赛失败。',
      };
    } finally {
      setSettingDefault(false);
    }
  }, [activeCompInfo, competition, competitionInfo?.title]);

  return {
    competitionInput,
    setCompetitionInput,
    competition,
    setCompetition,
    recentCompetitions,
    activeCompInfo,
    settingDefault,
    enteredCompetitions,
    enteredLoading,
    enteredError,
    sortBy,
    appliedSortBy: appliedQuery?.sort || sortBy,
    queryPending,
    setSortBy,
    pageSize,
    setPageSize,
    maxPages,
    setMaxPages,
    scoreLimit,
    setScoreLimit,
    kernels,
    setKernels,
    archives,
    setArchives,
    competitionInfo,
    setCompetitionInfo,
    confirmedDirection,
    setConfirmedDirection,
    loading,
    elapsedSeconds,
    error,
    setError,
    cacheInfo,
    backgroundRefreshing,
    loadKernels,
    loadEnteredCompetitions,
    togglePinActiveCompetition,
  };
}

export default useKernelListState;
