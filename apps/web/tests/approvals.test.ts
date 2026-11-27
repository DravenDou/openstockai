import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actionState,
  describeOperation,
  detailItems,
  detailRows,
  riskReason,
} from "../src/features/approvals/lib/operation";

const id = "0b1c6a3e-6d0e-4f0c-8f0d-3c1a2b4d5e6f";

test("operations map to plain-English titles and mark destructive ones", () => {
  assert.deepEqual(describeOperation("POST /v1/inventory/adjustments"), {
    title: "Adjust stock",
    destructive: false,
  });
  assert.equal(describeOperation("POST /v1/products").title, "Create a product");
  assert.equal(describeOperation(`PATCH /v1/warehouses/${id}`).title, "Edit a warehouse");
  const archive = describeOperation(`DELETE /v1/products/${id}`);
  assert.equal(archive.title, "Archive a product");
  assert.equal(archive.destructive, true);
  assert.deepEqual(archive.target, { kind: "product", id });
  const restore = describeOperation(`POST /v1/products/${id}/restore`);
  assert.equal(restore.title, "Restore a product");
  assert.equal(restore.destructive, true);
  assert.equal(describeOperation(`DELETE /v1/categories/${id}`).title, "Delete a category");
  assert.equal(describeOperation("POST /v1/units").title, "Create a unit of measure");
});

test("unknown operations are shown as unrecognized, never silently relabeled", () => {
  const info = describeOperation("POST /v1/secrets");
  assert.match(info.title, /^Unrecognized operation/);
  assert.equal(info.destructive, false);
  assert.equal(describeOperation("DELETE /v1/secrets").destructive, true);
});

test("risk reasons explain destructive, large-quantity and other owner-only decisions", () => {
  assert.match(riskReason(`DELETE /v1/products/${id}`, {}, true) ?? "", /Deletes, archives/);
  assert.match(
    riskReason("POST /v1/inventory/adjustments", { quantity: "1500" }, true) ?? "",
    /above 1000/,
  );
  assert.match(
    riskReason("POST /v1/inventory/adjustments", { quantity: "-1500" }, true) ?? "",
    /above 1000/,
  );
  assert.match(
    riskReason("POST /v1/purchases", { items: [{ quantity: 600 }, { quantity: "600" }] }, true) ??
      "",
    /above 1000/,
  );
  assert.match(
    riskReason("POST /v1/inventory/adjustments", { quantity: "5" }, true) ?? "",
    /requires the owner/,
  );
  assert.equal(riskReason("POST /v1/inventory/adjustments", { quantity: "5" }, false), null);
});

test("details come from toolInput with readable labels and resolvable ids", () => {
  const rows = detailRows({ productId: id, quantity: "5", note: null, items: [] });
  assert.deepEqual(rows, [
    { label: "Product", value: id, ref: "product" },
    { label: "Quantity", value: "5", ref: undefined },
  ]);
  assert.deepEqual(detailRows(null), []);
  assert.deepEqual(detailItems({ items: [{ productId: id, quantity: "3" }] }), [
    { product: id, quantity: "3" },
  ]);
});

test("the action state follows approval first, then the execution status", () => {
  assert.equal(actionState({ status: "pending", approvalStatus: "pending" }), "pending");
  assert.equal(actionState({ status: "pending", approvalStatus: "approved" }), "approved");
  assert.equal(actionState({ status: "failed", approvalStatus: "rejected" }), "rejected");
  assert.equal(actionState({ status: "completed", approvalStatus: "approved" }), "completed");
  assert.equal(actionState({ status: "completed", approvalStatus: "not_required" }), "completed");
});
