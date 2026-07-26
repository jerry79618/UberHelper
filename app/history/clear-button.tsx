"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type State = "idle" | "confirming" | "clearing" | "failed";

export function ClearHistoryButton({ count }: { count: number }) {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function clearAll() {
    setState("clearing");
    setErrorMessage("");

    try {
      const response = await fetch("/api/history", { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `伺服器回應 ${response.status}`);
      }
      setState("idle");
      // 這一頁是伺服器渲染的，要請 Next 重新取一次才會看到清空後的結果。
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "清除失敗，請稍後再試。",
      );
      setState("failed");
    }
  }

  if (state === "confirming") {
    return (
      <div className="clear-confirm">
        <span>確定要刪除全部 {count} 筆記錄？無法復原。</span>
        <button type="button" className="text-button danger" onClick={clearAll}>
          確定刪除
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => setState("idle")}
        >
          取消
        </button>
      </div>
    );
  }

  return (
    <div className="clear-confirm">
      {state === "failed" && (
        <span className="clear-error">清除失敗：{errorMessage}</span>
      )}
      <button
        type="button"
        className="text-button danger"
        disabled={state === "clearing"}
        onClick={() => setState("confirming")}
      >
        {state === "clearing" ? "清除中…" : "清除所有記錄"}
      </button>
    </div>
  );
}
