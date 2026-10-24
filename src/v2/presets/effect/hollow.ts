import { defineTextEffect } from "../define";

export default defineTextEffect({
  id: "hollow",
  name: "Hollow",
  category: "Style",
  description: "Outline-only letters with a transparent fill.",
  type: "hollow",
  frame: (f) => ({ ...f, fx: { ...f.fx, hollow: true } }),
  order: 20,
});
