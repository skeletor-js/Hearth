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
  agentGetModels: 'agent:models:get',
  agentSetModel: 'agent:model:set',
  agentModelsChanged: 'agent:models:changed', // main → renderer
  selfModHistory: 'self-mod:history',
  selfModUndo: 'self-mod:undo',
  selfModRedo: 'self-mod:redo',
  selfModActivity: 'self-mod:activity', // main → renderer: live subagent lanes (W4)
  selfModValidation: 'self-mod:validation', // main → renderer: post-edit typecheck result (W5)
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
  // personality (soul) + memory — managed blocks in each backend's global file.
  personalityGet: 'personality:get',
  personalitySet: 'personality:set',
  memoryGet: 'memory:get',
  memoryClear: 'memory:clear',
  // secrets: encrypted local store (BYO API keys + MCP env). Renderer sets/clears
  // and sees names only — never reads a value back.
  secretsList: 'secrets:list',
  secretsSet: 'secrets:set',
  secretsDelete: 'secrets:delete',
  secretsEncryptionAvailable: 'secrets:encryption-available',
  // auth: ACP-native auth status + guided login (no OAuth rendered, no token stored).
  authStatus: 'auth:status',
  authLogin: 'auth:login',
  authLogout: 'auth:logout',
  authChanged: 'auth:changed', // main → renderer
  // MCP servers the user adds (merged into each new ACP session).
  mcpList: 'mcp:list',
  mcpAdd: 'mcp:add',
  mcpUpdate: 'mcp:update',
  mcpRemove: 'mcp:remove',
  mcpSetEnabled: 'mcp:set-enabled',
  mcpTest: 'mcp:test',
  // skills: read-only discovery of Claude Code skills (global + workspace).
  skillsList: 'skills:list',
  skillsReveal: 'skills:reveal',
  // data & privacy.
  dataReveal: 'data:reveal', // open the data folder
  // about: app + adapter/SDK versions.
  aboutInfo: 'about:info',
  // window chrome: double-click the title-bar strip to zoom (fill) / restore.
  windowZoomToggle: 'window:zoom-toggle',
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
