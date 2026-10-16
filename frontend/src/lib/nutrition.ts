import type { MenuItem } from "@/lib/ordering";

export function nutritionLabel(item: Pick<MenuItem, "calories_kcal" | "nutrition_source" | "serving_size_description">): string {
  if (item.calories_kcal == null || item.nutrition_source == null) {
    return "Calories unavailable";
  }
  const kind = item.nutrition_source === "ILLUSTRATIVE" ? "Illustrative" : "Verified";
  const serving = item.serving_size_description?.trim() || "serving";
  return `${kind} ${item.calories_kcal} kcal / ${serving}`;
}
