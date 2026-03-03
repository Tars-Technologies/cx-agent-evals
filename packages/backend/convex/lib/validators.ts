import { v } from "convex/values";

export const spanValidator = v.object({
  docId: v.string(),
  start: v.number(),
  end: v.number(),
  text: v.string(),
});
