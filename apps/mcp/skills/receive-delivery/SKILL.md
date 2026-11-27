---
name: receive-delivery
description: Record goods that have arrived. Matches a delivery note to products by SKU, confirms the warehouse, creates unknown products first, then records one purchase.
---

# Receive a delivery

Use this only when the goods are physically there.

1. Ask which warehouse received the goods if the user has not said. Look it up with `list_reference_data` (`kind: "warehouses"`) and confirm the exact name.
2. For every line of the delivery note, find the product with `get_product` using its `sku`. Match on the SKU only, never on a similar name.
3. If a SKU is unknown, tell the user and offer `create_product` for it (name, SKU, cost and sale price, unit from `list_reference_data` with `kind: "units"`). Create it before the purchase. Do not invent prices or units.
4. Optionally find the supplier with `list_reference_data` (`kind: "suppliers"`).
5. Show the lines (SKU, name, quantity, unit cost) and the total, and get a clear yes from the user.
6. Call `record_purchase` once with a `reference` (the delivery note number) and all lines. Costs are decimal strings such as `14.99`.
7. Report the result. If the status is `declined_in_client` or `rejected_by_owner`, the stock was not added: say so and do not retry on your own.

Never split one delivery into several purchases, and never record the same delivery twice; check `list_purchases` with the reference if unsure.
