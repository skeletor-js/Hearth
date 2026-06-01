// The single source of truth for IPC channel names. Imported by BOTH the main
// process (electron/main/ipc.ts) and the preload bridge (electron/preload/
// index.ts) so the two can never drift. Add a channel here once; both sides see
// it. Each is a literal so the type is the exact channel string.

export const HEARTH_CHANNELS = {
  // renderer → main (invoke)
  agentPrompt: 'agent:prompt',
  agentCancel: 'agent:cancel',
  backendGet: 'agent:backend:get',
  backendSet: 'agent:backend:set',
  selfModHistory: 'self-mod:history',
  selfModUndo: 'self-mod:undo',
  microAppCreate: 'micro-app:create',
  microAppStart: 'micro-app:start',
  microAppStop: 'micro-app:stop',
  permissionRespond: 'permission:respond',

  // main → renderer (send/broadcast)
  agentUpdate: 'agent:update',
  agentError: 'agent:error',
  permissionRequest: 'permission:request',
  backendChanged: 'agent:backend:changed',
  viewNavigate: 'view:navigate', // ask the renderer to route somewhere before a snapshot
} as const

export type HearthChannel = (typeof HEARTH_CHANNELS)[keyof typeof HEARTH_CHANNELS]
