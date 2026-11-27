---
name: cycle-count
description: Run a physical stock count for a warehouse. Picks products, records counted quantities, and explains the variances. Large variances go to the owner.
---

# Cycle count

1. Confirm the warehouse (`list_reference_data`, `kind: "warehouses"`).
2. Pick products to count: start with `list_low_stock`, then products with recent movements (`get_stock_movements` with `warehouse`), then a few from `search_products` with the `warehouse` filter. Keep the list short enough to count in one session.
3. For each product, read the quantity on record just before counting with `get_product` (the `balances` entry for that warehouse). Ask the user for what was physically found.
4. Call `record_stock_count` with `expected` (the quantity on record) and `counted`. If the API rejects it because `expected` is stale, re-read the product and ask again; never overwrite newer movements.
5. After all counts, summarize: product, expected, counted, difference. Group big variances first and suggest likely causes only as questions (unrecorded sale, damaged goods, wrong warehouse).

Large variances (a count that differs from the record by a lot, or any quantity above 1000) need the owner's approval in OpenStock; tell the user the link shown by the approval prompt and wait for them. Never split a large correction into several small ones to avoid approval.
