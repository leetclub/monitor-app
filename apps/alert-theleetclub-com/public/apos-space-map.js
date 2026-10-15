/**
 * APOS Space Map — deep-space theme on the shared map engine.
 * Hierarchy: country → brand → area → site → machine → branches.
 * Signature: multi-layer starfield, muted nebulae, green fluorescent terminal.
 */
(function () {
  'use strict';
  if (!window.APOS_MAP_ENGINE) {
    console.error('APOS Space Map: missing APOS_MAP_ENGINE');
    return;
  }
  window.APOS_MAP_ENGINE.mount({
    theme: 'space',
    layout: 'countryTree',
    apiName: 'APOS_SPACE_MAP',
    readyFlag: '__APOS_SPACE_READY__',
    taskUi: 'terminal',
    dom: {
      stage: 'space-stage',
      svg: '#space-svg',
      world: 'space-world',
      leafCard: 'branch-card',
      leafCardTitle: 'branch-card-title',
      leafCardBody: 'branch-card-body',
      leafCardTask: 'branch-card-task',
      leafCardClose: 'branch-card-close',
      taskOverlay: 'terminal-overlay',
      taskClose: 'terminal-close',
      taskSend: 'term-send',
      taskAssignee: 'term-assignee',
      taskDesc: 'term-task',
      taskLog: 'term-log',
    },
  });
})();
