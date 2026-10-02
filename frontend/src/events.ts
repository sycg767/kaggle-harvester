export const HARVESTER_EVENTS = {
  simulationChanged: 'harvester:simulation-changed',
  archivesChanged: 'harvester:archives-changed',
  competitionChanged: 'harvester:competition-changed',
  defaultCompetitionChanged: 'harvester:default-competition-changed',
  focusCompetition: 'harvester:focus-competition',
} as const;

export const dispatchSimulationChanged = () => {
  window.dispatchEvent(new Event(HARVESTER_EVENTS.simulationChanged));
};

export const dispatchArchivesChanged = () => {
  window.dispatchEvent(new Event(HARVESTER_EVENTS.archivesChanged));
};

export const dispatchCompetitionChanged = (competition: string) => {
  window.dispatchEvent(new CustomEvent(HARVESTER_EVENTS.competitionChanged, {
    detail: competition,
  }));
};

export const dispatchDefaultCompetitionChanged = (competition: string) => {
  window.dispatchEvent(new CustomEvent(HARVESTER_EVENTS.defaultCompetitionChanged, {
    detail: competition,
  }));
};


