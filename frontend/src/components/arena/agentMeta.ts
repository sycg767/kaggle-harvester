import type { SimulationAgentStats } from '../../types/api';

export interface AgentMetaItem {
  name: string;
  shortName: string;
  tagColor: string;
  accent: string;
  borderColor: string;
  bg: string;
}

export const AGENT_PALETTE: Array<{ accent: string; tagColor: string; borderColor: string; bg: string }> = [
  {
    accent: '#007aff',
    tagColor: 'blue',
    borderColor: 'rgba(0, 122, 255, 0.22)',
    bg: 'rgba(0, 122, 255, 0.04)',
  },
  {
    accent: '#af52de',
    tagColor: 'purple',
    borderColor: 'rgba(175, 82, 222, 0.22)',
    bg: 'rgba(175, 82, 222, 0.04)',
  },
  {
    accent: '#34c759',
    tagColor: 'green',
    borderColor: 'rgba(52, 199, 89, 0.22)',
    bg: 'rgba(52, 199, 89, 0.04)',
  },
  {
    accent: '#ff9500',
    tagColor: 'orange',
    borderColor: 'rgba(255, 149, 0, 0.22)',
    bg: 'rgba(255, 149, 0, 0.04)',
  },
  {
    accent: '#5856d6',
    tagColor: 'geekblue',
    borderColor: 'rgba(88, 86, 214, 0.22)',
    bg: 'rgba(88, 86, 214, 0.04)',
  },
  {
    accent: '#ff2d55',
    tagColor: 'magenta',
    borderColor: 'rgba(255, 45, 85, 0.22)',
    bg: 'rgba(255, 45, 85, 0.04)',
  },
];

export const getAgentMeta = (agent: SimulationAgentStats, index: number): AgentMetaItem => {
  const theme = AGENT_PALETTE[index % AGENT_PALETTE.length];

  const customAlias = agent.alias?.trim();
  if (customAlias) {
    const displayName = customAlias.toLowerCase().startsWith('agent') ? customAlias : `Agent ${customAlias}`;
    return { name: displayName, shortName: customAlias, ...theme };
  }

  if (agent.submission_id === 55565346) {
    return {
      name: 'Agent p46',
      shortName: 'p46',
      ...theme,
    };
  }
  if (agent.submission_id === 55555162) {
    return {
      name: 'Agent p31',
      shortName: 'p31',
      ...theme,
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

