"use client";
import { Button } from "../ui/button";

export function HistoryNavigation({
  back,
  next,
  onBack,
  onNext,
}: {
  back: boolean;
  next: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mt-5 flex justify-between gap-3">
      <Button variant="outline" disabled={!back} onClick={onBack}>
        Newer
      </Button>
      <Button variant="outline" disabled={!next} onClick={onNext}>
        Older
      </Button>
    </div>
  );
}
