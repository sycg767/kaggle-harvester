import { useState } from 'react';
import { api, type ScoredKernel, type VersionInfo } from '../../api';

export function useKernelVersions() {
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [versionKernel, setVersionKernel] = useState<ScoredKernel | null>(null);
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);

  const showVersions = async (kernel: ScoredKernel, refresh = false) => {
    setVersionKernel(kernel);
    setVersionModalOpen(true);
    setVersionsError(null);
    if (refresh) {
      setRefreshing(true);
    } else {
      setVersions([]);
      setVersionsLoading(true);
    }
    try {
      const [owner, slug] = kernel.ref.split('/', 2);
      const data = await api.getKernelVersions(owner, slug, refresh);
      setVersions([...data.versions].sort((a, b) => b.version_number - a.version_number));
    } catch (err) {
      setVersionsError(err instanceof Error ? err.message : '版本历史读取失败。');
    } finally {
      setVersionsLoading(false);
      setRefreshing(false);
    }
  };

  const closeVersionModal = () => {
    setVersionModalOpen(false);
  };

  return {
    versionModalOpen,
    setVersionModalOpen,
    versionKernel,
    versions,
    versionsLoading,
    refreshing,
    versionsError,
    showVersions,
    closeVersionModal,
  };
}
