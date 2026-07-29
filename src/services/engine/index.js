/**
 * ★ Engine sub-module index — re-export all engine components
 */
'use strict';

module.exports = {
  quotaCoordinator: require('./quotaCoordinator'),
  pacingPlanner:    require('./pacingPlanner'),
  safetyGate:       require('./safetyGate'),
  retentionManager: require('./retentionManager'),
};
