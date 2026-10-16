/**
 * APOS Tree Map — indigo skilltree theme on the shared map engine.
 */
(function () {
  'use strict';
  if (!window.APOS_MAP_ENGINE) {
    console.error('APOS Tree Map: missing APOS_MAP_ENGINE');
    return;
  }
  window.APOS_MAP_ENGINE.mount({
    theme: 'tree',
    layout: 'brandHubs',
    apiName: 'APOS_TREE_MAP',
    readyFlag: '__APOS_TREE_READY__',
    taskUi: 'modal',
    dom: {
      stage: 'tree-stage',
      svg: '#tree-svg',
      world: 'tree-world',
      leafCard: 'leaf-card',
      leafCardTitle: 'leaf-card-title',
      leafCardBody: 'leaf-card-body',
      leafCardTask: 'leaf-card-task',
      leafCardClose: 'leaf-card-close',
      taskOverlay: 'task-overlay',
      taskClose: 'task-close',
      taskSend: 'task-send',
      taskAssignee: 'task-assignee',
      taskDesc: 'task-desc',
      taskLog: 'task-log',
    },
  });
})();
