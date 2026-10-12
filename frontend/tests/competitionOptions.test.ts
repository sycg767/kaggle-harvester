import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEnteredCompetitionOptions,
  ALLOWED_LATE_SUBMISSION_COMPETITIONS,
} from '../src/competitionOptions.ts';
import type { EnteredCompetition } from '../src/api.ts';

test('buildEnteredCompetitionOptions 默认排除已完赛，但保留指定的迟提交赛事与配置项', () => {
  const entered: EnteredCompetition[] = [
    {
      id: 'rsna-knee',
      title: 'RSNA Knee Abnormality Detection',
      deadline: '2099-01-01T00:00:00Z', // ongoing
    },
    {
      id: 'optiver-trading-at-the-close',
      title: 'Optiver - Trading at the Close',
      deadline: '2023-12-01T00:00:00Z', // ended
    },
    {
      id: 'pokemon-challenge',
      title: 'The Pokémon Company Challenge',
      deadline: '2023-01-01T00:00:00Z', // ended
    },
    {
      id: 'biohub-cell-tracking',
      title: 'Biohub - Cell Tracking',
      deadline: '2022-01-01T00:00:00Z', // ended
    },
  ];

  // 1. 常规场景（excludeEnded: true，无 allowedEndedSlugs）：只展示进行中的比赛
  const normalOptions = buildEnteredCompetitionOptions(entered, [], {
    excludeEnded: true,
  });
  assert.equal(normalOptions.length, 1);
  assert.equal(normalOptions[0].value, 'rsna-knee');

  // 2. 出分监控场景（指定 allowedEndedSlugs 包含 optiver）：保留 optiver，但绝不放出 pokemon 或 biohub
  const monitorOptions = buildEnteredCompetitionOptions(entered, [], {
    excludeEnded: true,
    allowedEndedSlugs: ALLOWED_LATE_SUBMISSION_COMPETITIONS,
  });
  assert.equal(monitorOptions.length, 2);
  const values = monitorOptions.map((o) => o.value);
  assert.ok(values.includes('rsna-knee'));
  assert.ok(values.includes('optiver-trading-at-the-close'));
  assert.ok(!values.includes('pokemon-challenge'));
  assert.ok(!values.includes('biohub-cell-tracking'));

  // 验证 Optiver 的标签包含“迟提交 / 已完赛”
  const optiverOption = monitorOptions.find((o) => o.value === 'optiver-trading-at-the-close');
  assert.ok(optiverOption?.label.includes('迟提交 / 已完赛'));

  // 3. 用户在 extras 中显式保存的项（即使已完赛）不被隐式丢弃
  const savedOptions = buildEnteredCompetitionOptions(entered, ['pokemon-challenge'], {
    excludeEnded: true,
    allowedEndedSlugs: ALLOWED_LATE_SUBMISSION_COMPETITIONS,
  });
  const savedValues = savedOptions.map((o) => o.value);
  assert.ok(savedValues.includes('pokemon-challenge'));
  assert.ok(savedValues.includes('optiver-trading-at-the-close'));
  assert.ok(savedValues.includes('rsna-knee'));
  assert.ok(!savedValues.includes('biohub-cell-tracking'));
});
