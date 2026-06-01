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
  // workbench: review diff + working-tree git ops (operate on a workspace cwd;
  // defaults to the Hearth repo until workspaces land in P3).
  gitDiff: 'git:diff',
  gitStatus: 'git:status',
  gitStage: 'git:stage',
  gitUnstage: 'git:unstage',
  gitCommit: 'git:commit',
  gitBranches: 'git:branches',
  gitSwitchBranch: 'git:switch-branch',
  gitCreatePr: 'git:create-pr',
  // workspaces: the built-in Hearth workspace + user-opened folders.
  workspacesList: 'workspaces:list',
  workspacesOpen: 'workspaces:open',
  workspacesRemove: 'workspaces:remove',
  workspacesStatus: 'workspaces:status',
  // sessions: persistent conversations (JSONL transcript + JSON index).
  sessionsList: 'sessions:list',
  sessionsCreate: 'sessions:create',
  sessionsGet: 'sessions:get',
  sessionsAppend: 'sessions:append',
  sessionsRename: 'sessions:rename',
  sessionsArchive: 'sessions:archive',
  sessionsDelete: 'sessions:delete',
  sessionsDuplicate: 'sessions:duplicate',
  // files: workspace-rooted filesystem for the Files tab + editor.
  fsList: 'fs:list',
  fsRead: 'fs:read',
  fsWrite: 'fs:write',
  // terminal: a real PTY per panel.
  terminalCreate: 'terminal:create',
  terminalWrite: 'terminal:write',
  terminalResize: 'terminal:resize',
  terminalKill: 'terminal:kill',
  terminalData: 'terminal:data', // main → renderer
  terminalExit: 'terminal:exit', // main → renderer
  // browser: embedded persistent WebContentsView (floats above the renderer).
  browserOpen: 'browser:open',
  browserNavigate: 'browser:navigate',
  browserBack: 'browser:back',
  browserForward: 'browser:forward',
  browserReload: 'browser:reload',
  browserSetBounds: 'browser:set-bounds',
  browserHide: 'browser:hide',
  browserState: 'browser:state', // main → renderer
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
