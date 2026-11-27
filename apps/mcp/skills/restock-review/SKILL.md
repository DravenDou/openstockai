---
name: restock-review
description: Review what to reorder. Combines low stock, turnover and supplier spend into a purchase plan the owner can act on. Plans only; never records purchases.
---

# Restock review

Produce a short purchase plan from live data. Do not record anything.

1. Call `list_low_stock` and page until `hasMore` is false. These are the candidates.
2. Call `get_report` with `report: "turnover"` (default 90 days). A low-stock product that is also a top mover is urgent; one that appears under slow movers can usually wait or be dropped.
3. Call `get_report` with `report: "supplier_spend"` to see which suppliers you already buy from and how much. Use `list_reference_data` with `kind: "suppliers"` for supplier IDs.
4. For each candidate, call `get_product` to see the stock per warehouse, and `get_stock_movements` for recent outflow if the quantity to order is not obvious.
5. Present a table: product (SKU), stock, minimum, suggested quantity, likely supplier, reason. Suggest enough to cover about the turnover window, never a guess without data. Say clearly when data is missing.

Rules:

- Never call `record_purchase` for goods that have not arrived. A plan is not a purchase; recording happens in the `receive-delivery` skill.
- Money values are decimal strings in the store currency; do not do float arithmetic on them without saying it is approximate.
