# P012 cart and order animations

The existing food flight was kept. The cart is saved before the animation starts. The flight reads the food image and the visible `[data-cart-target]` rectangle, then follows a quadratic curve with a higher arc. A missing image shows the item's first letter. Reduced motion skips the flight and updates the badge immediately. At most four flights run at once. The badge spring uses the existing `landed` counter.

The success scene still renders only from an order object the caller already received. Its kinetic lines are `ORDER IN.` and `HAPPINESS LOADING.` Skip and Track my order remain. The ticket shows the returned ticket number, items, total, status, payment method, and payment status.

On the tracking page, status `ACCEPTED` reads `THE KITCHEN'S ON IT.` That line is the headline for the status returned by the API. It is not shown for `PLACED`.

These screens were not exercised in a browser during this session. The Docker frontend image was not rebuilt, so the running site on port 3010 still serves the previous bundle.
