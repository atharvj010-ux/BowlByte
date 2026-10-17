import type { MenuItem } from "@/lib/ordering";

export type MenuSort = "recommended" | "price_asc" | "price_desc" | "name";

export function groupInMenuOrder(items: MenuItem[]): { id: string; name: string; items: MenuItem[] }[] {
  const groups: { id: string; name: string; items: MenuItem[] }[] = [];
  for (const item of items) {
    const current = groups.at(-1);
    if (current === undefined || current.id !== item.category_id) {
      groups.push({ id: item.category_id, name: item.category_name, items: [item] });
    } else {
      current.items.push(item);
    }
  }
  return groups;
}
