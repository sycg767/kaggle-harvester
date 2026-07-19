export const HARVESTER_EVENTS = {
  archivesChanged: 'harvester:archives-changed',
  competitionChanged: 'harvester:competition-changed',
  focusCompetition: 'harvester:focus-competition',
} as const;

export const dispatchArchivesChanged = () => {
  window.dispatchEvent(new Event(HARVESTER_EVENTS.archivesChanged));
};

export const dispatchCompetitionChanged = (competition: string) => {
  window.dispatchEvent(new CustomEvent(HARVESTER_EVENTS.competitionChanged, {
    detail: competition,
  }));
};

