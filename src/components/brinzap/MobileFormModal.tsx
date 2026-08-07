"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/**
 * Padrão de formulário mobile-first do Abio.
 * Todos os modais de formulário devem usar estes componentes.
 *
 * - Mobile: bottom sheet, 100% de largura, scroll interno, safe-area.
 * - Tablet (md+): grid de 2 colunas opcional via <MobileFieldRow>.
 * - Desktop: modal centralizado com largura máxima.
 */

export function MobileFormModal({
  open,
  onOpenChange,
  title,
  description,
  children,
  submitLabel = "Salvar",
  cancelLabel = "Cancelar",
  onSubmit,
  submitting = false,
  submitDisabled = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  submitLabel?: string;
  cancelLabel?: string;
  onSubmit: () => void;
  submitting?: boolean;
  submitDisabled?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden border border-border bg-background shadow-2xl outline-none",
            // Mobile: bottom sheet ocupando a largura toda
            "inset-x-0 bottom-0 top-auto w-full max-h-[92dvh] rounded-t-3xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
            // Desktop: modal centralizado
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:max-h-[88dvh]",
            "sm:data-[state=open]:slide-in-from-bottom-2 sm:data-[state=closed]:slide-out-to-bottom-2",
          )}
        >
          {/* Header fixo */}
          <div className="relative shrink-0 border-b border-border px-5 pb-4 pt-[calc(1rem+env(safe-area-inset-top)*0.25)] sm:px-6 sm:pt-5">
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-border sm:hidden" />
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <div className="min-w-0">
                <DialogPrimitive.Title className="font-display text-lg leading-tight sm:text-xl">
                  {title}
                </DialogPrimitive.Title>
                {description ? (
                  <DialogPrimitive.Description className="mt-1 text-xs text-muted-foreground">
                    {description}
                  </DialogPrimitive.Description>
                ) : null}
              </div>
              <DialogPrimitive.Close
                aria-label="Fechar"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-card/60 text-muted-foreground transition-colors hover:text-foreground active:scale-95"
              >
                <X className="h-5 w-5" />
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* Corpo com scroll interno */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 [-webkit-overflow-scrolling:touch]">
            <div className="space-y-4">{children}</div>
          </div>

          {/* Ações fixas, respeitando safe area */}
          <div className="shrink-0 border-t border-border bg-background/95 px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-6 sm:pb-5">
            <div className="flex flex-col gap-3 sm:flex-row-reverse">
              <Button
                onClick={onSubmit}
                disabled={submitting || submitDisabled}
                className="h-13 w-full rounded-2xl bg-neon text-base font-semibold text-neon-foreground hover:bg-neon/90 active:scale-[0.99] sm:h-11 sm:w-auto sm:px-6 sm:text-sm"
              >
                {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : submitLabel}
              </Button>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="h-13 w-full rounded-2xl border-border text-base sm:h-11 sm:w-auto sm:px-6 sm:text-sm"
              >
                {cancelLabel}
              </Button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Campo: label + controle, sempre 100% de largura. */
export function MobileField({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <div className="[&_input]:h-12 [&_input]:w-full [&_input]:rounded-2xl [&_button[role=combobox]]:h-12 [&_button[role=combobox]]:w-full [&_button[role=combobox]]:rounded-2xl [&_textarea]:w-full [&_textarea]:rounded-2xl">
        {children}
      </div>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Linha: empilhada no mobile, 2 colunas a partir de 768px (md). */
export function MobileFieldRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-1 gap-4 md:grid-cols-2", className)}>{children}</div>;
}
