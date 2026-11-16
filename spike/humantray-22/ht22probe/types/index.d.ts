export type Probe = { ticks: number; lastTick: number; renders: number; received: number }

declare module 'claude-code' {
  interface PluginState {
    ht22probe: { probe: Shaped<Probe> }
  }
}
