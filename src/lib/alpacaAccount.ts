import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";

export type PaperAccount = "paper1" | "paper2";

const STORAGE_KEY = "alpaca_paper_account";
const EVENT = "alpaca-paper-account-change";
const DEFAULT: PaperAccount = "paper2";

export function getPaperAccount(): PaperAccount {
  if (typeof window === "undefined") return DEFAULT;
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "paper1" || v === "paper2" ? v : DEFAULT;
}

export function setPaperAccount(value: PaperAccount) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, value);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: value }));
}

export function usePaperAccount(): [PaperAccount, (v: PaperAccount) => void] {
  const [value, setValue] = useState<PaperAccount>(getPaperAccount());
  useEffect(() => {
    const handler = () => setValue(getPaperAccount());
    window.addEventListener(EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);
  return [value, setPaperAccount];
}

/**
 * Wrapper around supabase.functions.invoke("alpaca-trade", ...) that automatically
 * injects the currently selected paperAccount so all calls hit the chosen paper account.
 * Accepts the same options shape as supabase.functions.invoke (i.e. `{ body, headers? }`).
 * Live mode is unaffected (the edge function ignores paperAccount when mode === "live").
 */
export function invokeAlpacaTrade(options: { body: Record<string, any>; headers?: Record<string, string> }) {
  const paperAccount = getPaperAccount();
  return supabase.functions.invoke("alpaca-trade", {
    ...options,
    body: { paperAccount, ...(options.body || {}) },
  });
}