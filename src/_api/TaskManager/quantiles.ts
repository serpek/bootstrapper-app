// (Önceki P2 estimator aynen; tekrar eklemiyorum değişiklik olmadı)
export class P2QuantileEstimator {
  private readonly markers: Array<{
    q: number
    n: number[]
    ns: number[]
    dn: number[]
    heights: number[]
    initialized: boolean
    buffer: number[]
  }>

  constructor(probabilities: number[]) {
    this.markers = probabilities.map((p) => ({
      q: p,
      n: [0, 0, 0, 0, 0],
      ns: [0, 0, 0, 0, 0],
      dn: [0, p / 2, p, (1 + p) / 2, 1],
      heights: [0, 0, 0, 0, 0],
      initialized: false,
      buffer: []
    }))
  }

  addSample(x: number) {
    for (const m of this.markers) {
      if (!m.initialized) {
        m.buffer.push(x)
        if (m.buffer.length === 5) {
          m.buffer.sort((a, b) => a - b)
          m.heights = [...m.buffer]
          m.n = [0, 1, 2, 3, 4]
          m.ns = [0, 2 * m.q, 4 * m.q, 2 + 2 * m.q, 4]
          m.initialized = true
          m.buffer.length = 0
        }
        continue
      }
      let k: number
      if (x < m.heights[0]) {
        m.heights[0] = x
        k = 0
      } else if (x >= m.heights[4]) {
        m.heights[4] = x
        k = 3
      } else {
        for (k = 0; k < 4; k++) {
          if (x >= m.heights[k] && x < m.heights[k + 1]) break
        }
      }
      for (let i = k + 1; i < 5; i++) m.n[i] += 1
      for (let i = 0; i < 5; i++) m.ns[i] += m.dn[i]
      for (let i = 1; i < 4; i++) {
        const d = m.ns[i] - m.n[i]
        const sign = Math.sign(d)
        if (
          (sign > 0 && m.n[i + 1] - m.n[i] > 1) ||
          (sign < 0 && m.n[i - 1] - m.n[i] < -1)
        ) {
          const h =
            m.heights[i] +
            (sign *
              (((m.n[i] - m.n[i - 1] + sign) *
                (m.heights[i + 1] - m.heights[i])) /
                (m.n[i + 1] - m.n[i]) +
                ((m.n[i + 1] - m.n[i] - sign) *
                  (m.heights[i] - m.heights[i - 1])) /
                  (m.n[i] - m.n[i - 1]))) /
              (m.n[i + 1] - m.n[i - 1])
          if (h > m.heights[i - 1] && h < m.heights[i + 1]) {
            m.heights[i] = h
          } else {
            m.heights[i] =
              m.heights[i] +
              (sign * (m.heights[i + sign] - m.heights[i])) /
                (m.n[i + sign] - m.n[i])
          }
          m.n[i] += sign
        }
      }
    }
  }

  estimate(p: number): number | null {
    const m = this.markers.find((mk) => mk.q === p)
    if (!m) return null
    if (!m.initialized) {
      if (!m.buffer.length) return null
      const sorted = [...m.buffer].sort((a, b) => a - b)
      const idx = Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil(p * sorted.length) - 1)
      )
      return sorted[idx]
    }
    return m.heights[2]
  }

  estimates(): Record<string, number | null> {
    const out: Record<string, number | null> = {}
    for (const m of this.markers) {
      out[`p${Math.round(m.q * 100)}`] = this.estimate(m.q)
    }
    return out
  }

  reset() {
    for (const m of this.markers) {
      m.initialized = false
      m.buffer.length = 0
      m.n = [0, 0, 0, 0, 0]
      m.ns = [0, 0, 0, 0, 0]
    }
  }
}
