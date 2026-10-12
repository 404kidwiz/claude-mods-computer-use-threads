export type CodexCuPending = { app: string; caller?: string; title?: string } | null

declare module 'claude-code' {
  interface PluginState {
    'codex-computer-use': { pending: CodexCuPending; allowed: Record<string, string[]>; denied: string[] }
  }
}
