import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import type { SimulationAgentStats, SimulationEpisodePageResponse } from '../../types/api';

interface UseSimulationEpisodesOptions {
  open: boolean;
  isTargetCompActive: boolean;
  agents: SimulationAgentStats[];
  onError?: (err: Error) => void;
}

export function useSimulationEpisodes({
  open,
  isTargetCompActive,
  agents,
  onError,
}: UseSimulationEpisodesOptions) {
  const [episodePages, setEpisodePages] = useState<Record<number, SimulationEpisodePageResponse>>({});
  const [episodeLoading, setEpisodeLoading] = useState<Record<number, boolean>>({});
  const episodeRequestedTotals = useRef<Record<number, number>>({});
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const fetchEpisodePage = useCallback(
    async (submissionId: number, page = 1, pageSize = 6) => {
      setEpisodeLoading((previous) => ({ ...previous, [submissionId]: true }));
      try {
        const data = await api.getSimulationEpisodes(submissionId, (page - 1) * pageSize, pageSize);
        if (isMounted.current) {
          setEpisodePages((previous) => ({ ...previous, [submissionId]: data }));
        }
      } catch (err: any) {
        if (isMounted.current && onError) {
          onError(err);
        }
      } finally {
        if (isMounted.current) {
          setEpisodeLoading((previous) => ({ ...previous, [submissionId]: false }));
        }
      }
    },
    [onError]
  );

  useEffect(() => {
    if (!open || !isTargetCompActive) return;
    agents.slice(0, 2).forEach((agent) => {
      if (
        !episodeLoading[agent.submission_id] &&
        episodeRequestedTotals.current[agent.submission_id] !== agent.total_episodes &&
        (!episodePages[agent.submission_id] ||
          episodePages[agent.submission_id].total !== agent.total_episodes)
      ) {
        episodeRequestedTotals.current[agent.submission_id] = agent.total_episodes;
        void fetchEpisodePage(agent.submission_id);
      }
    });
  }, [agents, episodeLoading, episodePages, fetchEpisodePage, open, isTargetCompActive]);

  return {
    episodePages,
    episodeLoading,
    fetchEpisodePage,
  };
}

export default useSimulationEpisodes;
