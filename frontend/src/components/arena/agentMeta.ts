import type { SimulationAgentStats } from '../../types/api';

export interface AgentMetaItem {
  name: string;
  shortName: string;
  tagColor: string;
  borderColor: string;
  bg: string;
}

export const getAgentMeta = (agent: SimulationAgentStats, index: number): AgentMetaItem => {
  const themes = [
    { tagColor: 'green', borderColor: '#bbf7d0', bg: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)' },
    { tagColor: 'purple', borderColor: '#e9d5ff', bg: 'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)' },
    { tagColor: 'blue', borderColor: '#bfdbfe', bg: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)' },
    { tagColor: 'orange', borderColor: '#fed7aa', bg: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)' },
  ];
  const theme = themes[index % themes.length];

  const customAlias = agent.alias?.trim();
  if (customAlias) {
    const displayName = customAlias.toLowerCase().startsWith('agent') ? customAlias : `Agent ${customAlias}`;
    return { name: displayName, shortName: customAlias, ...theme };
  }

  if (agent.submission_id === 55565346) {
    return {
      name: 'Agent p46',
      shortName: 'p46',
      tagColor: 'green',
      borderColor: '#bbf7d0',
      bg: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
    };
  }
  if (agent.submission_id === 55555162) {
    return {
      name: 'Agent p31',
      shortName: 'p31',
      tagColor: 'purple',
      borderColor: '#e9d5ff',
      bg: 'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)',
    };
  }
  const raw = (agent.description || agent.file_name || '').trim();
  const match = raw.match(/^(p\d+(?:plus\d+)?|p\d+|agent[\s\-_]?\w+)/i);
  if (match) {
    const clean = match[1].replace(/[:_\-—]+$/, '');
    const displayName = clean.toLowerCase().startsWith('agent') ? clean : `Agent ${clean}`;
    return { name: displayName, shortName: clean, ...theme };
  }
  return { name: `Agent #${index + 1}`, shortName: `Agent #${index + 1}`, ...theme };
};
