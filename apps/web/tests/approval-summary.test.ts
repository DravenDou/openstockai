import assert from "node:assert/strict";
import { test } from "node:test";
import {
  optionLabel,
  purchaseTotal,
  summarizeApproval,
  summarizeInteraction,
} from "../src/features/assistant/lib/approval-summary";
import { toolLabels } from "../src/features/assistant/lib/chat";

const id = "550e8400-e29b-41d4-a716-446655440003";
const warehouse = "550e8400-e29b-41d4-a716-446655440001";

test("deletes, archives and restores are marked destructive with a specific confirm label", () => {
  const cases: [string, string][] = [
    ["deleteCategory", "Delete category"],
    ["deleteSupplier", "Delete supplier"],
    ["deleteWarehouse", "Delete warehouse"],
    ["archiveProduct", "Archive product"],
    ["restoreProduct", "Restore product"],
  ];
  for (const [tool, confirm] of cases) {
    const summary = summarizeApproval(tool, { id });
    assert.equal(summary.destructive, true, tool);
    assert.equal(summary.confirm, confirm);
    assert.equal(summary.rows[0]?.value, id);
    assert.ok(summary.rows[0]?.ref);
    assert.ok(summary.note);
  }
});

test("routine writes are not marked destructive", () => {
  for (const tool of [
    "createProduct",
    "adjustStock",
    "recordPurchase",
    "updateSettings",
    "createUnit",
  ])
    assert.equal(summarizeApproval(tool, {}).destructive, false, tool);
});

test("a purchase lists its lines and an exact total", () => {
  const summary = summarizeApproval("recordPurchase", {
    reference: "Purchase order 42",
    warehouseId: warehouse,
    items: [
      { productId: id, quantity: 3, costPrice: "9.99" },
      { productId: id, quantity: 0.5, costPrice: "10.00" },
    ],
  });
  assert.equal(summary.items?.length, 2);
  assert.equal(summary.total, "34.97");
  assert.deepEqual(summary.rows[0], { label: "Reference", value: "Purchase order 42" });
  assert.equal(summary.rows[1]?.ref, "warehouse");
  assert.equal(purchaseTotal([{ quantity: "0.001", cost: "0.01" }]), "0.00");
});

test("a stock count shows the signed difference", () => {
  const summary = summarizeApproval("countStock", {
    productId: id,
    warehouseId: warehouse,
    expected: 10,
    counted: 7.5,
  });
  assert.equal(summary.rows.find((row) => row.label === "Difference")?.value, "-2.5");
});

test("settings changes use readable labels and warn when enabling auto-approval", () => {
  const summary = summarizeApproval("updateSettings", { automatic: true, currency: "EUR" });
  assert.deepEqual(
    summary.rows.map((row) => [row.label, row.value]),
    [
      ["Auto-approve low-risk actions", "On"],
      ["Currency", "EUR"],
    ],
  );
  assert.match(summary.note ?? "", /still ask/);
});

test("product writes resolve names and format money", () => {
  const summary = summarizeApproval("createProduct", {
    name: "Bolt M8",
    sku: "BOLT-M8",
    categoryId: id,
    costPrice: "0.10",
    salePrice: "0.25",
    initialStock: 100,
    warehouseId: warehouse,
  });
  assert.equal(summary.rows.find((row) => row.label === "Category")?.ref, "category");
  assert.equal(summary.rows.find((row) => row.label === "Cost")?.money, true);
  assert.equal(summary.rows.find((row) => row.label === "In warehouse")?.ref, "warehouse");
});

test("an unknown tool still renders its scalar inputs", () => {
  const summary = summarizeApproval("somethingNew", { name: "X", nested: { a: 1 } });
  assert.deepEqual(summary.rows, [{ label: "Name", value: "X" }]);
});

test("every write tool has a chat label", () => {
  for (const tool of [
    "recordPurchase",
    "updateSettings",
    "deleteCategory",
    "exportProductsCsv",
    "getStockValuation",
  ])
    assert.ok(toolLabels[tool], tool);
});

test("a budget prompt has its own title and keeps Eve's option labels", () => {
  const summary = summarizeInteraction("budget", "", undefined);
  assert.equal(summary.title, "Session token budget reached");
  assert.equal(summary.destructive, false);
  assert.equal(optionLabel("budget", { id: "approve", label: "Continue" }, summary), "Continue");
  assert.equal(optionLabel("budget", { id: "deny", label: "Stop" }, summary), "Stop");
  const tool = summarizeInteraction("approval", "archiveProduct", { id });
  assert.equal(optionLabel("approval", { id: "approve", label: "Yes" }, tool), "Archive product");
  assert.equal(optionLabel("approval", { id: "deny", label: "No" }, tool), "Reject");
});
