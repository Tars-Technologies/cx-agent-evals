import { describe, expect, it } from "vitest"
import { computeImageSetMetrics } from "../../../src/evaluation/metrics/image.js"

describe("computeImageSetMetrics", () => {
  it("returns 1/1/1 when there is no ground truth", () => {
    expect(computeImageSetMetrics(["img_a"], [])).toEqual({
      image_recall: 1,
      image_precision: 1,
      image_f1: 1
    })
  })

  it("returns 0/0/0 when nothing was offered", () => {
    expect(computeImageSetMetrics([], ["img_a"])).toEqual({
      image_recall: 0,
      image_precision: 0,
      image_f1: 0
    })
  })

  it("does not floor precision at 1/menuSize when the single relevant image ranks first", () => {
    // A menu cap of 6 with only 1 relevant image used to force precision <= 1/6
    // under plain set precision, even for a perfect ranking. Precision@K (K=1)
    // only checks the top-1 offered image, so a correct top rank scores 1.0.
    const offered = ["img_correct", "img_b", "img_c", "img_d", "img_e", "img_f"]
    const result = computeImageSetMetrics(offered, ["img_correct"])
    expect(result.image_recall).toBe(1)
    expect(result.image_precision).toBe(1)
    expect(result.image_f1).toBe(1)
  })

  it("penalizes a correct-but-lower-ranked relevant image", () => {
    // Relevant image ranks 4th out of 6 — top-1 check misses it.
    const offered = ["img_a", "img_b", "img_c", "img_correct", "img_e", "img_f"]
    const result = computeImageSetMetrics(offered, ["img_correct"])
    expect(result.image_recall).toBe(1) // it did appear in the menu
    expect(result.image_precision).toBe(0) // but not in the top-K=1 slot
  })

  it("scales K with groundTruth size for multiple relevant images", () => {
    // 2 relevant images, both correctly ranked in the top 2 offered.
    const offered = ["img_a", "img_b", "img_c", "img_d"]
    const result = computeImageSetMetrics(offered, ["img_a", "img_b"])
    expect(result.image_precision).toBe(1)
    expect(result.image_recall).toBe(1)
  })

  it("caps K at the offered length when fewer images were offered than groundTruth", () => {
    const offered = ["img_a"]
    const result = computeImageSetMetrics(offered, ["img_a", "img_b"])
    // K = min(2, 1) = 1; top-1 offered is a hit.
    expect(result.image_precision).toBe(1)
    // recall still measures against the full groundTruth size.
    expect(result.image_recall).toBe(0.5)
  })
})
