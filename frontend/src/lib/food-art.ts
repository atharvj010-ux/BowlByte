export type FoodArt = { src: string; small: string; dish: string };

// Generated studio images. They illustrate a kind of dish, never a specific
// canteen item, so every surface that shows one must say "Illustrative".
const library: [RegExp, string][] = [
  [/dosa/, "dosa"],
  [/idli/, "idli"],
  [/burger/, "burger"],
  [/sandwich|toast/, "sandwich"],
  [/fries/, "fries"],
  [/samosa/, "samosa"],
  [/maggi|noodle/, "maggi"],
  [/rice|biryani|pulao/, "fried-rice"],
  [/cold coffee|iced coffee|frappe/, "cold-coffee"],
  [/chai|tea|filter coffee|coffee/, "chai"],
  [/coke|cola|soda|pepsi|drink|lime/, "cola"],
];

export const showcase = {
  burger: art("burger"),
  fries: art("fries"),
  dosa: art("dosa"),
  sandwich: art("sandwich"),
  coldCoffee: art("cold-coffee"),
  samosa: art("samosa"),
  maggi: art("maggi"),
  chai: art("chai"),
  cola: art("cola"),
  idli: art("idli"),
  rice: art("fried-rice"),
};

function art(dish: string): FoodArt {
  return { src: `/food/${dish}.webp`, small: `/food/${dish}-sm.webp`, dish };
}

export function foodArt(name: string): FoodArt | null {
  const value = name.toLowerCase();
  const match = library.find(([pattern]) => pattern.test(value));
  return match ? art(match[1]) : null;
}

/** The canteen's own photo wins. Otherwise an illustrative image, if one fits the name. */
export function foodImage(item: { name: string; image_url: string | null }): {
  src: string;
  illustrative: boolean;
} | null {
  if (item.image_url) {
    return { src: item.image_url, illustrative: false };
  }
  const fallback = foodArt(item.name);
  return fallback ? { src: fallback.small, illustrative: true } : null;
}
