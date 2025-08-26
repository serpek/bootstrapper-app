import { ReconnectConfig } from './types'

export interface BackoffCalculation {
  attempt: number
  plannedDelay: number
  jitteredDelay: number
}

export function calculateBackoffDelay(
  attempt: number,
  cfg: ReconnectConfig
): BackoffCalculation {
  const base =
    cfg.initialDelayMs * Math.pow(cfg.multiplier, Math.max(0, attempt - 1))
  const plannedDelay = Math.min(cfg.maxDelayMs, base)
  if (cfg.jitterRatio <= 0) {
    return { attempt, plannedDelay, jitteredDelay: plannedDelay }
  }
  const band = plannedDelay * cfg.jitterRatio
  const min = plannedDelay - band / 2
  const max = plannedDelay + band / 2
  const jitteredDelay = Math.max(
    0,
    Math.round(min + Math.random() * (max - min))
  )
  return { attempt, plannedDelay, jitteredDelay }
}
