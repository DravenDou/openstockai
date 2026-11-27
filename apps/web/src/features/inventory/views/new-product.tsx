"use client";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ProductForm } from "../components/product-form";
import { BackLink, PageHeading } from "../../../shared/components/shared";
export function NewProductView() {
  const router = useRouter();
  return (
    <>
      <PageHeading title="Add product" description="Set the unit, prices and initial stock.">
        <BackLink />
      </PageHeading>
      <ProductForm
        onSaved={(id) => {
          toast.success("Product saved");
          router.push(`/inventory/${id}`);
        }}
        onCancel={() => router.push("/inventory")}
      />
    </>
  );
}
